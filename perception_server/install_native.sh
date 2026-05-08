#!/bin/bash
# install_native.sh - Robust installation for ASAR Perception Stack on ROCm 7.0.0

set -e

echo "Cleaning up previous environment..."
rm -rf .venv-perception

echo "Creating virtual environment..."
python3.12 -m venv .venv-perception
source .venv-perception/bin/activate

echo "Updating pip and installing base tools..."
pip install --upgrade pip setuptools wheel

echo "Installing Stable ROCm 6.2.4 stack from AMD Official Mirror..."

# 1. Install core ROCm components from AMD's official release mirror
# This ensures we get binaries matched to the 6.2.4 stable release.
pip install --no-cache-dir \
    "torch==2.4.0+rocm6.2.4" \
    "torchvision==0.19.0+rocm6.2.4" \
    "vllm==0.5.4+rocm624" \
    --find-links https://repo.radeon.com/rocm/manylinux/rocm-rel-6.2.4/

# 2. Install support dependencies with strict NumPy 1.x compatibility
pip install --no-cache-dir \
    "numpy<2.0.0" "opencv-python-headless<4.11" "fastapi" "uvicorn[standard]" \
    "python-multipart" "pillow" "transformers>=4.40" "ray==2.35.0"

echo "Native installation complete!"
echo "To activate the environment: source .venv-perception/bin/activate"
