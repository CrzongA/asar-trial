# GroundingDINO detector server for the ASAR perception pipeline.
#
# Base image: ROCm PyTorch. On the MI300X this gets hardware acceleration for
# free; the same image runs on a CPU host (slower) for testing.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /opt/perception
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-dev python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Pin torch + torchvision to a matched release pair. Using the ROCm 6.3
# wheel index; these wheels are ABI-compatible with a ROCm 6.2 host.
RUN pip3 install --no-cache-dir \
    torch>=2.4 torchvision>=0.19 \
    --index-url https://download.pytorch.org/whl/rocm6.3

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY detector_server.py .

EXPOSE 8001
CMD ["python3.10", "detector_server.py"]
