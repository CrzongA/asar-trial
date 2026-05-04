#!/bin/bash
echo "Starting Gazebo Harmonic for ASAR..."

# Ensure we have the ROS 2 setup sourced
if [ -f "/opt/ros/jazzy/setup.bash" ]; then
    source /opt/ros/jazzy/setup.bash
else
    echo "Warning: /opt/ros/jazzy/setup.bash not found. Make sure ROS 2 is active."
fi

# Trap SIGINT to kill background processes on exit
trap 'kill 0' SIGINT

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

# Start Gazebo Harmonic in the background
echo "Launching Gazebo world: asar_world.sdf"
export LIBGL_ALWAYS_SOFTWARE=1
export MESA_LOADER_DRIVER_OVERRIDE=llvmpipe
export GALLIUM_DRIVER=llvmpipe
xvfb-run -a -s "-screen 0 1024x768x24" gz sim -v 4 -s -r --headless-rendering "$DIR/asar_world.sdf" &
GZ_PID=$!

echo "Waiting for Gazebo to initialize..."
sleep 5

# Start the ROS-Gazebo bridge for the camera topic
# Note: In Gazebo Harmonic, we map gz.msgs.Image to sensor_msgs/msg/Image
echo "Starting ros_gz_bridge for /camera/image_raw"
ros2 run ros_gz_bridge parameter_bridge /camera/image_raw@sensor_msgs/msg/Image[gz.msgs.Image &
BRIDGE_PID=$!

echo "Simulator and Bridge are running. Press Ctrl+C to exit."
wait
