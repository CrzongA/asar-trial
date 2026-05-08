# GroundingDINO detector server for the ASAR perception pipeline.
#
# Base image: AMD's official ROCm 7.1.1 PyTorch image. On the MI300X this
# gets hardware acceleration (gfx942 / ROCm 7.x); the same image falls back
# to CPU on hosts without /dev/kfd for developer testing.
#
# ROCm 7.1.1 userspace is backward-compatible with the ROCm 7.0 KFD kernel
# driver via the stable KFD ioctl interface.
FROM rocm/pytorch:rocm7.1.1_ubuntu22.04_py3.10_pytorch_release_2.10.0

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /opt/perception
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# torch and torchvision are pre-installed in the base image.
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY detector_server.py .

EXPOSE 8001
CMD ["python3.10", "detector_server.py"]
