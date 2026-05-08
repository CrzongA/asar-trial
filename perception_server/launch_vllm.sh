#!/bin/bash
# launch_vllm.sh - Launch vLLM for Qwen2.5-VL-72B-Instruct on MI300X

# Default values
MODEL=${VLM_MODEL:-"Qwen/Qwen2.5-VL-72B-Instruct"}
PORT=${VLM_PORT:-8000}
TP=${VLM_TP:-1}
MAX_MODEL_LEN=${VLM_MAX_LEN:-32768}

# ROCm/MI300X specific environment variables
export PYTORCH_ROCM_ARCH="gfx942"
export ROCM_PATH=${ROCM_PATH:-"/opt/rocm"}
export LD_LIBRARY_PATH="$ROCM_PATH/lib:$ROCM_PATH/lib64:$LD_LIBRARY_PATH"

# Workaround for some RCCL/NCCL issues
export NCCL_P2P_DISABLE=1
export NCCL_IB_DISABLE=1

# Ensure venv is activated if it exists
if [ -d ".venv-perception" ]; then
    source .venv-perception/bin/activate
fi

echo "Launching vLLM with model: $MODEL"
echo "Targeting MI300X (gfx942) with Tensor Parallelism: $TP"

vllm serve "$MODEL" \
    --port "$PORT" \
    --tensor-parallel-size "$TP" \
    --max-model-len "$MAX_MODEL_LEN" \
    --gpu-memory-utilization 0.95 \
    --trust-remote-code \
    --host 0.0.0.0
