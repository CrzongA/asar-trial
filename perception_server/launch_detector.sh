#!/bin/bash
# launch_detector.sh - Launch GroundingDINO detector server

# Default values
PORT=${DETECTOR_PORT:-8001}
MODEL_ID=${DETECTOR_MODEL_ID:-"IDEA-Research/grounding-dino-tiny"}

# Ensure venv is activated if it exists
if [ -d ".venv-perception" ]; then
    source .venv-perception/bin/activate
fi

export ROCM_PATH=${ROCM_PATH:-"/opt/rocm"}
export LD_LIBRARY_PATH="$ROCM_PATH/lib:$ROCM_PATH/lib64:$LD_LIBRARY_PATH"

echo "Launching Detector Server on port $PORT..."
export DETECTOR_PORT=$PORT
export DETECTOR_MODEL_ID=$MODEL_ID

python3 detector_server.py
