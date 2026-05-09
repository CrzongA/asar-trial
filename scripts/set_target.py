#!/usr/bin/env python3
import sys
import os
import subprocess
import cv2
import numpy as np

# Configuration based on rubicon.sdf and heightmap properties
WORLD_NAME = "asar_world"
MODEL_NAME = "target_capsule"
MAP_PATH = os.path.expanduser("~/asar-trial/sim/models/rubicon/materials/textures/Heightmap.png")
MAP_SIZE_M = 37.5
MAP_HEIGHT_M = 5.0

def get_height(x, y):
    if not os.path.exists(MAP_PATH):
        print(f"Error: Heightmap not found at {MAP_PATH}")
        return 1.0 # Default fallback
    
    img = cv2.imread(MAP_PATH, cv2.IMREAD_GRAYSCALE)
    if img is None:
        print(f"Error: Could not read heightmap image")
        return 1.0

    h, w = img.shape
    
    # Map (x, y) to (pixel_x, pixel_y)
    # Gazebo (0,0) is at the center of the heightmap
    # x: [-18.75, 18.75] -> [0, 512]
    # y: [-18.75, 18.75] -> [512, 0] (image y is top-to-bottom)
    
    px = int((x / MAP_SIZE_M + 0.5) * (w - 1))
    py = int((0.5 - y / MAP_SIZE_M) * (h - 1))
    
    # Clip to image boundaries
    px = max(0, min(w - 1, px))
    py = max(0, min(h - 1, py))
    
    pixel_val = img[py, px]
    ground_z = (pixel_val / 255.0) * MAP_HEIGHT_M
    
    return ground_z

def set_pose(x, y, z):
    # Construct the gz service command
    # Using gz service -s /world/<world>/set_pose --reqtype gz.msgs.Pose --reptype gz.msgs.Boolean ...
    # However, it's often easier to use 'gz service -s /world/asar_world/set_pose' with --data
    
    # Pose message format for gz service:
    # name: "target_capsule"
    # position { x: 1.0 y: 2.0 z: 3.0 }
    
    data = f'name: "{MODEL_NAME}", position {{ x: {x}, y: {y}, z: {z} }}'
    cmd = [
        "gz", "service",
        "-s", f"/world/{WORLD_NAME}/set_pose",
        "--reqtype", "gz.msgs.Pose",
        "--reptype", "gz.msgs.Boolean",
        "--timeout", "1000",
        "--req", data
    ]
    
    print(f"Moving {MODEL_NAME} to ({x}, {y}, {z})...")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print("Success!")
    except subprocess.CalledProcessError as e:
        print(f"Error calling gz service: {e.stderr}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: ./set_target.py <x> <y> [offset_z]")
        sys.exit(1)
        
    try:
        x = float(sys.argv[1])
        y = float(sys.argv[2])
        offset_z = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5 # Default offset so it's not buried
        
        ground_z = get_height(x, y)
        target_z = ground_z + offset_z
        
        set_pose(x, y, target_z)
    except ValueError:
        print("Coordinates must be numbers")
