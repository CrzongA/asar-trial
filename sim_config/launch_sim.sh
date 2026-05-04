#!/bin/bash
# Bootstrap the ASAR simulator: uXRCE-DDS agent + Gazebo Harmonic + PX4 SITL + ros_gz bridges.
#
# Layout assumed:
#   $REPO/sim_config/                - this directory
#   $REPO/sim_config/models/asar_drone/ - custom model (wraps x500_gimbal)
#   $REPO/sim_config/asar_world.sdf  - world (without a static drone)
#   $PX4_DIR (default: ~/PX4-Autopilot) - PX4-Autopilot source tree, built once via:
#       make px4_sitl gz_x500_gimbal
#
# PX4 connects to the uXRCE-DDS agent on UDP 8888 (the agent runs in docker via
# infrastructure/docker-compose.yml). All PX4 topics are then visible under /fmu/in/* and /fmu/out/*.

set -eo pipefail

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
REPO="$( cd "$DIR/.." && pwd )"
PX4_DIR="${PX4_DIR:-$HOME/PX4-Autopilot}"

# --- ROS 2 + Gazebo env ----------------------------------------------------
if [ -f "/opt/ros/jazzy/setup.bash" ]; then
    source /opt/ros/jazzy/setup.bash
else
    echo "ERROR: /opt/ros/jazzy/setup.bash not found." >&2
    exit 1
fi

# Overlay the ROS workspace if it has been built (for px4_msgs + mission_control nodes).
if [ -f "$REPO/ros_ws/install/setup.bash" ]; then
    source "$REPO/ros_ws/install/setup.bash"
fi

# Make Gazebo find both PX4's stock models and our custom asar_drone wrapper.
export GZ_SIM_RESOURCE_PATH="$REPO/sim_config/models:$PX4_DIR/Tools/simulation/gz/models:${GZ_SIM_RESOURCE_PATH:-}"
export GZ_SIM_SYSTEM_PLUGIN_PATH="$PX4_DIR/build/px4_sitl_default/build_gz_plugins:${GZ_SIM_SYSTEM_PLUGIN_PATH:-}"

# Headless rendering for server / CI environments.
export LIBGL_ALWAYS_SOFTWARE=1
export MESA_LOADER_DRIVER_OVERRIDE=llvmpipe
export GALLIUM_DRIVER=llvmpipe

# --- Process management ----------------------------------------------------
PIDS=()
cleanup() {
    echo "Shutting down..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    docker compose -f "$REPO/infrastructure/docker-compose.yml" stop micro_xrce_dds 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- 1. uXRCE-DDS agent (docker) ------------------------------------------
echo "[1/4] Starting uXRCE-DDS agent (docker, UDP 8888)..."
docker compose -f "$REPO/infrastructure/docker-compose.yml" up -d micro_xrce_dds

# --- 2. Gazebo Harmonic with our world ------------------------------------
echo "[2/4] Launching Gazebo with $DIR/asar_world.sdf ..."
xvfb-run -a -s "-screen 0 1280x720x24" \
    gz sim -v 4 -s -r --headless-rendering "$DIR/asar_world.sdf" &
PIDS+=($!)
sleep 6

# --- 3. PX4 SITL in standalone mode ---------------------------------------
# PX4_GZ_STANDALONE=1: don't let PX4 start its own Gazebo; attach to ours.
# PX4_GZ_WORLD=asar_world: the world we just launched.
# PX4_SIM_MODEL=asar_drone: spawn our wrapper (which includes x500_gimbal).
# Make target gz_x500_gimbal still selects the correct airframe params (4019).
echo "[3/4] Starting PX4 SITL (asar_drone in asar_world)..."
(
    cd "$PX4_DIR" && \
    PX4_GZ_STANDALONE=1 \
    PX4_GZ_WORLD=asar_world \
    PX4_SIM_MODEL=asar_drone \
    make px4_sitl gz_x500_gimbal
) &
PIDS+=($!)
sleep 8

# --- 4. ros_gz bridges ----------------------------------------------------
# Camera: the gimbal cam has no explicit <topic>, so Gazebo names it by entity path.
# Clock: needed so ROS nodes use sim time from PX4/Gazebo.
echo "[4/4] Starting ros_gz_bridge (camera + clock)..."
CAM_GZ_TOPIC="/world/asar_world/model/asar_drone/link/camera_link/sensor/camera/image"
ros2 run ros_gz_bridge parameter_bridge \
    "${CAM_GZ_TOPIC}@sensor_msgs/msg/Image[gz.msgs.Image" \
    "/clock@rosgraph_msgs/msg/Clock[gz.msgs.Clock" \
    --ros-args --remap "${CAM_GZ_TOPIC}:=/camera/image_raw" &
PIDS+=($!)

echo
echo "Bringup complete. Topics:"
echo "  /camera/image_raw           (Gazebo camera bridged to ROS)"
echo "  /fmu/out/vehicle_local_position, /fmu/out/vehicle_status, ... (PX4 telemetry)"
echo "  /fmu/in/trajectory_setpoint, /fmu/in/manual_control_input, ... (PX4 commands)"
echo "Press Ctrl+C to stop everything."
wait
