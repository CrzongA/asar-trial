#!/bin/bash
# ASAR Script: Install rosbridge_suite for ROS 2 Jazzy
#
# This script handles the source installation of rosbridge_suite on the jazzy branch
# and ensures all Python dependencies are present in the project's .venv.

set -e

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
ROS_WS="$REPO_DIR/ros_ws"
VENV="$REPO_DIR/.venv"

echo "=== Installing rosbridge_suite (Jazzy) ==="

# 1. Install Python dependencies into .venv
if [ -d "$VENV" ]; then
    echo "[1/3] Installing Python dependencies (tornado, lark, twisted) into .venv..."
    "$VENV/bin/pip" install tornado lark twisted
else
    echo "WARNING: .venv not found at $VENV. Skipping pip install."
fi

# 2. Clone rosbridge_suite jazzy branch
echo "[2/3] Cloning rosbridge_suite (branch: jazzy)..."
mkdir -p "$ROS_WS/src"
if [ -d "$ROS_WS/src/rosbridge_suite" ]; then
    echo "rosbridge_suite already exists. Updating..."
    cd "$ROS_WS/src/rosbridge_suite"
    git fetch origin
    git checkout jazzy
    git pull origin jazzy
else
    git clone -b jazzy https://github.com/RobotWebTools/rosbridge_suite.git "$ROS_WS/src/rosbridge_suite"
fi

# 3. Build the workspace
echo "[3/3] Building ROS 2 workspace (ignoring tests to skip ament_cmake_mypy)..."
if [ -f "/opt/ros/jazzy/setup.bash" ]; then
    source /opt/ros/jazzy/setup.bash
fi

cd "$ROS_WS"
colcon build --symlink-install \
    --packages-up-to rosbridge_server \
    --cmake-args -DBUILD_TESTING=OFF

echo ""
echo "=== Installation Complete ==="
echo "You can now run the bridge using: bash infrastructure/launch_bridge.sh"
