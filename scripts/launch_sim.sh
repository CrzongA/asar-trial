#!/bin/bash
# Bootstrap the ASAR simulator: uXRCE-DDS agent + Gazebo Harmonic + PX4 SITL + ros_gz bridges.
#
# Layout assumed:
#   $REPO/scripts/                   - this directory
#   $REPO/sim/models/asar_drone/     - custom model (wraps x500_gimbal)
#   $REPO/sim/asar_world.sdf         - world (without a static drone)
#   $PX4_DIR (default: ~/PX4-Autopilot) - PX4-Autopilot source tree, built once via:
#       make px4_sitl gz_x500_gimbal
#
# PX4 connects to the uXRCE-DDS agent on UDP 8888 (MicroXRCEAgent, built natively via
# scripts/install_xrce_agent.sh). All PX4 topics are then visible under /fmu/in/* and /fmu/out/*.

set -eo pipefail
export ROS_DISABLE_LOANED_MESSAGES=1

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

# Source virtual environment and workspace
if [ -f "$REPO/.venv/bin/activate" ]; then
    source "$REPO/.venv/bin/activate"
fi
if [ -f "$REPO/ros_ws/install/setup.bash" ]; then
    source "$REPO/ros_ws/install/setup.bash"
fi

# Source PX4's gz environment file BEFORE launching Gazebo. This is required
# so Gazebo loads PX4's server.config (which registers the IMU, magnetometer,
# NavSat, air-pressure, and sensors systems). Without it, x500_gimbal's sensors
# exist on the model but produce no data, and PX4's failsafe_flags stays all-true.
# It also sets PX4_GZ_MODELS, which PX4-rc.gzsim needs to build the spawn URI in
# standalone mode (its own sourcing of this file is gated to the non-standalone
# branch). The file is auto-generated at build time by PX4's CMake.
GZ_ENV="$PX4_DIR/build/px4_sitl_default/rootfs/gz_env.sh"
if [ -f "$GZ_ENV" ]; then
    . "$GZ_ENV"
else
    echo "ERROR: $GZ_ENV not found. Build PX4 first: (cd \$PX4_DIR && make px4_sitl)" >&2
    exit 1
fi

# Prepend our custom-model directory so $REPO/sim/models/asar_drone is
# discoverable on top of PX4's stock models (which gz_env.sh appended above).
export GZ_SIM_RESOURCE_PATH="$REPO/sim/models:$GZ_SIM_RESOURCE_PATH"

# Headless rendering for server / CI environments.
# export LIBGL_ALWAYS_SOFTWARE=1
# export MESA_LOADER_DRIVER_OVERRIDE=llvmpipe
# export GALLIUM_DRIVER=llvmpipe

# --- Process management ----------------------------------------------------
PIDS=()
cleanup() {
    echo "Shutting down..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- 1. uXRCE-DDS agent (native) ------------------------------------------
# Built into ros_ws via scripts/install_xrce_agent.sh; sourced from install/setup.bash above.
# Output is redirected to /tmp/xrce_agent.log so the agent's reply path isn't
# back-pressured by the shared tty during PX4's burst of CREATE requests.
# `tail -f /tmp/xrce_agent.log` in another terminal for live view.
echo "[1/4] Starting uXRCE-DDS agent (native, UDP 8888) -> /tmp/xrce_agent.log ..."
if ! command -v MicroXRCEAgent >/dev/null 2>&1; then
    echo "ERROR: MicroXRCEAgent not on PATH. Run scripts/install_xrce_agent.sh first." >&2
    exit 1
fi
MicroXRCEAgent udp4 -p 8888 -v 2 >/tmp/xrce_agent.log 2>&1 &
PIDS+=($!)
sleep 1

# --- 2. Gazebo Harmonic with our world ------------------------------------
echo "[2/4] Launching Gazebo with $REPO/sim/asar_world.sdf ..."
xvfb-run -a -s "-screen 0 1280x720x24" \
    gz sim -v 4 -s -r --headless-rendering "$REPO/sim/asar_world.sdf" &
PIDS+=($!)
sleep 6

# --- 3. PX4 SITL in standalone mode ---------------------------------------
# PX4_GZ_STANDALONE=1: don't let PX4 start its own Gazebo; attach to ours.
# PX4_GZ_WORLD=asar_world: the world that step [2/4] just launched.
# Make target gz_x500_gimbal selects airframe 4019 AND forces PX4_SIM_MODEL=gz_x500_gimbal
# (the make target overrides any user-set value — see gz_bridge/CMakeLists.txt).
# Env (PX4_GZ_MODELS, GZ_SIM_RESOURCE_PATH, etc.) is already exported above.
#
# PX4_PARAM_<NAME>=<value> is a built-in PX4 hook (see rcS line ~229) that runs
# `param set <NAME> <value>` at boot. Project-owned param overrides without
# touching PX4's source tree:
#   COM_RC_IN_MODE=1     — MAVLink-only (already SITL default; explicit for clarity).
#   COM_RCL_EXCEPT=4     — exempt OFFBOARD from the RC-loss failsafe (bit 2).
#   NAV_DLL_ACT=0        — disable GCS-connection failsafe. Airframe 4001_gz_x500
#                          (parent of gz_x500_gimbal) sets this to 2 by default,
#                          which blocks arming with "Preflight Fail: No connection
#                          to the GCS" since we have no QGroundControl attached.
#   CBRK_SUPPLY_CHK=894281 — bypass the avionics power-monitor check (no power
#                          module in SITL); blocks arming with "Preflight Fail:
#                          system power unavailable".
echo "[3/4] Starting PX4 SITL (x500_gimbal in asar_world)..."
(
    cd "$PX4_DIR" && \
    PX4_GZ_STANDALONE=1 \
    PX4_GZ_WORLD=asar_world \
    PX4_PARAM_COM_RC_IN_MODE=1 \
    PX4_PARAM_COM_RCL_EXCEPT=4 \
    PX4_PARAM_NAV_DLL_ACT=0 \
    PX4_PARAM_CBRK_SUPPLY_CHK=894281 \
    make px4_sitl gz_x500_gimbal
) &
PIDS+=($!)
sleep 8

# --- 4. ros_gz bridges ----------------------------------------------------
# Camera: the gimbal cam has no explicit <topic>, so Gazebo names it by entity path.
# Clock: needed so ROS nodes use sim time from PX4/Gazebo.
echo "[4/4] Starting ros_gz_bridge (camera + clock)..."
CAM_GZ_TOPIC="/world/asar_world/model/x500_gimbal_0/link/camera_link/sensor/camera/image"
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
