#!/bin/bash
# ASAR Bridge Launcher: mission_node + teleop_node + mission_manager + sar_agent
#                     + rosbridge_server + webrtc_streamer
#
# Starts all ROS 2 flight-control, autonomy, and web-bridge nodes needed for
# the frontend. The sar_agent reads VLM_BASE_URL and DETECTOR_URL from the
# environment (default: http://vlm-host:8000 and :8001 over Tailscale).

set -e

# --- ROS 2 env ----------------------------------------------------
if [ -f "/opt/ros/jazzy/setup.bash" ]; then
    source /opt/ros/jazzy/setup.bash
else
    echo "ERROR: /opt/ros/jazzy/setup.bash not found." >&2
    exit 1
fi

# Source virtual environment and workspace
if [ -f "$(dirname "$0")/../.venv/bin/activate" ]; then
    source "$(dirname "$0")/../.venv/bin/activate"
fi
if [ -f "$(dirname "$0")/../ros_ws/install/setup.bash" ]; then
    source "$(dirname "$0")/../ros_ws/install/setup.bash"
fi

# --- Process management ----------------------------------------------------
PIDS=()
cleanup() {
    echo "Shutting down bridge..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    exit 0
}
trap cleanup EXIT INT TERM

# --- 1. mission_node ------------------------------------------------------
echo "[1/6] Starting mission_node ..."
ros2 run mission_control mission_node &
PIDS+=($!)

# --- 2. teleop_node -------------------------------------------------------
# Bridges /teleop/manual_input -> /fmu/in/manual_control_input at 50 Hz.
# Must be running before any "take control" request so PX4 receives RC input
# in POSITION mode; without it PX4 fires manual_control_signal_lost failsafe.
echo "[2/6] Starting teleop_node ..."
ros2 run mission_control teleop_node &
PIDS+=($!)

# --- 3. mission_manager ---------------------------------------------------
# Provides /mission/record_target_status service and republishes status to
# /mission/target_status (latched) for the frontend.
echo "[3/6] Starting mission_manager ..."
ros2 run mission_manager mission_manager_node &
PIDS+=($!)

# --- 4. sar_agent ---------------------------------------------------------
# Autonomous SAR orchestrator. Subscribes to /sar/briefing and runs the
# Briefing -> Plan -> Recon -> Acquire -> Secure cycle. Calls the perception
# servers (GroundingDINO + Qwen3-VL via vLLM) on the MI300X over Tailscale.
echo "[4/6] Starting sar_agent ..."
: "${VLM_BASE_URL:=http://vlm-host:8000}"
: "${DETECTOR_URL:=http://vlm-host:8001}"
export VLM_BASE_URL DETECTOR_URL
echo "       VLM_BASE_URL=$VLM_BASE_URL"
echo "       DETECTOR_URL=$DETECTOR_URL"
ros2 run sar_agent agent_node &
PIDS+=($!)

# --- 5. rosbridge_server (WebSocket port 9090) ---------------------------
echo "[5/6] Starting rosbridge_server on ws://0.0.0.0:9090 ..."
export ROS_DISABLE_LOANED_MESSAGES=1
ros2 launch rosbridge_server rosbridge_websocket_launch.xml &
PIDS+=($!)

# --- 6. webrtc_streamer.py (WebRTC port 8080) ----------------------------
echo "[6/6] Starting video streamer on http://0.0.0.0:8080 ..."
python3 "$(dirname "$0")/../middleware/webrtc_streamer.py" &
PIDS+=($!)

echo "All nodes active. Keep this terminal open."
wait
