#!/bin/bash
# ASAR Bridge Launcher: rosbridge_server + webrtc_streamer (MJPEG)
#
# This script bridges the internal ROS 2 network to the web frontend.

set -e

# --- ROS 2 env ----------------------------------------------------
if [ -f "/opt/ros/jazzy/setup.bash" ]; then
    source /opt/ros/jazzy/setup.bash
else
    echo "ERROR: /opt/ros/jazzy/setup.bash not found." >&2
    exit 1
fi

# Overlay workspace
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

# --- 1. rosbridge_server (WebSocket port 9090) ---------------------------
echo "[1/2] Starting rosbridge_server on ws://0.0.0.0:9090 ..."
ros2 launch rosbridge_server rosbridge_websocket_launch.xml &
PIDS+=($!)

# --- 2. webrtc_streamer.py (MJPEG port 8080) -----------------------------
echo "[2/2] Starting video streamer on http://0.0.0.0:8080 ..."
python3 "$(dirname "$0")/webrtc_streamer.py" &
PIDS+=($!)

echo "Bridge active. Keep this terminal open."
wait
