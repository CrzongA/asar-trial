#!/bin/bash
# ASAR Script: Install Micro-XRCE-DDS-Agent (eProsima) for ROS 2 Jazzy
#
# Vendors the agent into ros_ws/src so it builds as a sibling colcon package.
# v2.4.3 is the version pinned for Jazzy by the PX4 docs; v3.x is incompatible
# with the PX4 uXRCE-DDS client.

set -e

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
ROS_WS="$REPO_DIR/ros_ws"
AGENT_DIR="$ROS_WS/src/Micro-XRCE-DDS-Agent"
AGENT_TAG="v2.4.3"

echo "=== Installing Micro-XRCE-DDS-Agent ($AGENT_TAG) ==="

# 1. Clone (or update) the agent at the pinned tag
echo "[1/2] Fetching Micro-XRCE-DDS-Agent ($AGENT_TAG)..."
mkdir -p "$ROS_WS/src"
if [ -d "$AGENT_DIR" ]; then
    echo "Micro-XRCE-DDS-Agent already exists. Updating to $AGENT_TAG..."
    cd "$AGENT_DIR"
    git fetch --tags origin
    git checkout "$AGENT_TAG"
    git reset --hard "$AGENT_TAG"
else
    git clone -b "$AGENT_TAG" https://github.com/eProsima/Micro-XRCE-DDS-Agent.git "$AGENT_DIR"
fi

# 2. Build via colcon
echo "[2/2] Building Micro-XRCE-DDS-Agent with colcon..."
if [ -f "/opt/ros/jazzy/setup.bash" ]; then
    source /opt/ros/jazzy/setup.bash
fi

cd "$ROS_WS"
colcon build --symlink-install --packages-select Micro-XRCE-DDS-Agent

echo ""
echo "=== Installation Complete ==="
echo "Re-source the workspace: source ros_ws/install/setup.bash"
echo "MicroXRCEAgent is now on PATH; scripts/launch_sim.sh will use it."
