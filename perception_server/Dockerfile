# GroundingDINO detector server for the ASAR perception pipeline.
#
# Base image: ROCm PyTorch. On the MI300X this gets hardware acceleration for
# free; the same image runs on a CPU host (slower) for testing.
FROM rocm/pytorch:rocm6.2_ubuntu22.04_py3.10_pytorch_2.3.0

WORKDIR /opt/perception
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY detector_server.py .

EXPOSE 8001
CMD ["python3", "detector_server.py"]
