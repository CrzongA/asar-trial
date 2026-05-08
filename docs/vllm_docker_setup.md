# vLLM Docker Setup on MI300X (ROCm 7.0)

Target hardware: AMD Instinct MI300X VF (Digital Ocean droplet), single VF with 192 GB VRAM, ROCm 7.0.

## Services

Two containers defined in `perception_server/docker-compose.yml`:

| Service | Image | Port | Role |
|---|---|---|---|
| `asar_vllm` | `rocm/vllm:latest` | 8000 | Qwen2.5-VL-72B inference (OpenAI-compatible API) |
| `asar_detector` | built from `perception_server/Dockerfile` | 8001 | GroundingDINO zero-shot detection |

## Bring up

```bash
docker compose -f perception_server/docker-compose.yml up -d
```

Smoke-test after startup (model download + load takes several minutes on first run):

```bash
curl http://localhost:8000/v1/models      # vLLM ready
curl http://localhost:8001/healthz        # GroundingDINO ready
```

---

## Issues encountered during setup

### 1. ROCm wheel version (detector image)

**Symptom:** Detector container failed to use the GPU or produced silent CPU fallback.

**Cause:** The original Dockerfile used `--index-url https://download.pytorch.org/whl/rocm6.3` on a ROCm 7.0 host. The `rocm7.0` wheel index on pytorch.org exists but is empty (no stable wheels as of 2026-05).

**Fix:** Switch the detector base image to AMD's official ROCm PyTorch image, which ships torch built against the correct ROCm version:

```dockerfile
FROM rocm/pytorch:rocm7.1.1_ubuntu22.04_py3.10_pytorch_release_2.10.0
```

ROCm 7.1.1 userspace is backward-compatible with the 7.0 KFD kernel driver via the stable KFD ioctl interface.

---

### 2. Wrong GPU count (vLLM tensor-parallel-size)

**Symptom:**

```
torch.AcceleratorError: HIP error: invalid device ordinal
GPU device may be out of range, do you have enough GPUs?
```

**Cause:** The compose file was originally configured for 8× MI300X (`tensor-parallel-size 8`, `HIP_VISIBLE_DEVICES=0,...,7`). The Digital Ocean MI300X droplet exposes a single Virtual Function (VF). `rocm-smi` confirms one device; `rocminfo` shows two `gfx942` entries, but these are ISA variants of the same VF, not separate GPUs.

**Fix:**

```yaml
environment:
  - HIP_VISIBLE_DEVICES=0
command: >
  ...
  --tensor-parallel-size 1
```

72B BF16 ≈ 144 GB fits comfortably in a single 192 GB VF with ~48 GB left for KV cache at `max-model-len 8192`.

---

### 3. Gloo "Unable to find interface for 0.0.0.0" (vLLM)

**Symptom:**

```
RuntimeError: [enforce fail at gloo/transport/tcp/device.cc:212]
ifa != nullptr. Unable to find interface for: [0.0.0.0]
```

**Cause:** vLLM's v1 engine always spawns a `DPEngineCoreProc` (named `EngineCore_DP0`) that initialises a gloo process group for coordination, even with `data-parallel-size 1`. Gloo's TCP transport receives the string `0.0.0.0` as the rendezvous address (sourced from the `--host 0.0.0.0` API-server flag), then tries to find a NIC whose IP matches that string literally. `0.0.0.0` is not assigned to any NIC, so the assert fails.

**Fix:** Set `GLOO_SOCKET_IFNAME` to the host's primary network interface so gloo binds to a concrete NIC instead of resolving by IP:

```yaml
environment:
  - GLOO_SOCKET_IFNAME=eth0
```

Reference: https://discuss.pytorch.org/t/runtime-error-using-distributed-with-gloo/16579

Note: `VLLM_HOST_IP=127.0.0.1` was also added as a belt-and-suspenders measure, but `GLOO_SOCKET_IFNAME=eth0` is the operative fix.
