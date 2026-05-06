# ASAR — Autonomous Search and Rescue Simulation Framework

A simulation framework for autonomous drone-based search and rescue, combining a high-fidelity Gazebo environment, a PX4 autopilot, a locally-hosted Vision Language Model (VLM), and a real-time web dashboard.

> **Hardware Target**: AMD MI300X (~192 GB VRAM). The entire stack — simulator, VLM inference, and middleware — runs on ROCm and standard graphics APIs (Vulkan). No NVIDIA CUDA dependency.

---

## Architecture

The core design principle is a **Reason-Act-Observe** loop, which reconciles the high latency of VLM inference with the hard real-time requirements of drone flight control.

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js Dashboard                    │
│   VideoPlayer │ MissionMap │ Telemetry │ VLM Console    │
└──────────────────────┬──────────────────────────────────┘
          roslib (WS)  │  WebRTC
          ─────────────┤──────────────────────────────
                       │ rosbridge_server + webrtc_streamer
          ─────────────┴──────────────────────────────
                    ROS 2 Jazzy (DDS)
        ┌──────────────┬───────────────────────────┐
        │              │                           │
   vlm_agent     mission_control         ros_gz_bridge
  (Observe+Reason)   (Act)            (Gazebo ↔ ROS)
        │              │                           │
        │     PX4 SITL (waypoints)       Gazebo Harmonic
        │     Micro-XRCE-DDS             asar_world.sdf
        │              │
   vLLM REST API   /camera/image_raw
  Qwen3-VL-235B
  (ROCm Docker)
```

| Phase | Component | Frequency |
|---|---|---|
| **Observe** | `vlm_agent` captures `/camera/image_raw` | 1–2 FPS |
| **Reason** | Qwen3-VL performs semantic matching & task translation | Async |
| **Act** | PX4 SITL executes waypoints from `mission_control` | 50 Hz+ |

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Simulator | Gazebo Harmonic + Ogre2 | Vulkan rendering, AMD-friendly |
| Flight Stack | PX4 SITL + Micro-XRCE-DDS | Realistic flight dynamics |
| Middleware | ROS 2 Jazzy | LTS; handles all inter-process comms |
| VLM Inference | Qwen3-VL-235B-A22B-Instruct-FP8 via vLLM | ROCm Docker; OpenAI-compatible API |
| Video Stream | aiohttp MJPEG + aiortc WebRTC | Dual-mode; WebRTC preferred |
| Frontend | Next.js 15 / React 19 / Tailwind CSS 4 | TypeScript throughout |
| Mapping | Leaflet + react-leaflet | GPS track and VLM waypoint markers |

---

## Repository Layout

```
asar-trial/
├── sim/
│   ├── asar_world.sdf          # Gazebo world: ground plane, red-target cylinder
│   └── models/                 # Custom Gazebo models (asar_drone wraps x500_gimbal)
│
├── middleware/
│   ├── docker-compose.yml      # vLLM (ROCm) service definition
│   ├── webrtc_streamer.py      # MJPEG + WebRTC signaling server (port 8080)
│   └── webrtc_streamer_backup.py
│
├── scripts/
│   ├── launch_sim.sh           # Headless Gazebo + PX4 SITL + ros_gz_bridge
│   ├── launch_bridge.sh        # rosbridge_server + webrtc_streamer
│   ├── install_xrce_agent.sh   # Builds Micro-XRCE-DDS-Agent v2.4.3 into ros_ws
│   └── install_rosbridge.sh    # Builds rosbridge into ros_ws
│
├── ros_ws/
│   └── src/
│       ├── vlm_agent/          # Observe+Reason node → /vlm/target_detections
│       └── mission_control/    # Act node, consumes VLM detections → PX4 waypoints
│
├── frontend/
│   └── src/
│       ├── app/page.tsx        # Main dashboard layout
│       └── components/
│           ├── VideoPlayer.tsx         # Snapshot-polling fallback
│           ├── VideoPlayerWebRTC.tsx   # WebRTC peer stream
│           ├── MissionMap.tsx          # Leaflet GPS + waypoint map
│           ├── TelemetryDashboard.tsx  # Altitude, speed, battery
│           └── VLMConsole.tsx          # Live VLM reasoning log
│
├── requirements.txt            # Python deps: aiohttp, aiortc, opencv-python, …
└── implementation_plan.md      # Full design document
```

---

## Current Status

| Component | Status |
|---|---|
| Gazebo world (drone, camera, target) | **Complete** |
| Headless sim launcher | **Complete** |
| ros_gz_bridge (Gazebo → ROS image topic) | **Complete** |
| MJPEG / WebRTC streamer | **Complete** |
| vlm_agent ROS node | **Mocked** — hardcoded detection, no real vLLM call |
| mission_control ROS node | **Skeleton** — logs detections, no waypoint generation |
| vLLM (Qwen3-VL) Docker service | **Defined** — not yet wired to vlm_agent |
| PX4 SITL integration | **Planned** — Micro-XRCE-DDS container defined |
| Frontend dashboard | **Functional** — all panels render with mocked data |
| roslib.js live data | **Planned** — rosbridge_server not yet connected |
| Automated ROS unit tests | **Planned** |

---

## Prerequisites

- ROS 2 Jazzy
- Gazebo Harmonic (`gz-harmonic`)
- `ros-jazzy-ros-gz-bridge`
- Docker + Docker Compose (for vLLM and DDS agent)
- ROCm-compatible AMD GPU (MI300X targeted)
- Node.js ≥ 20 and `npm`
- Python ≥ 3.10 with `venv`

---

## Setup

### 1. Python environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Build ROS workspace

Vendor Micro-XRCE-DDS-Agent (eProsima v2.4.3, the version pinned for Jazzy by PX4) into `ros_ws/src` and build it alongside the workspace:

```bash
./scripts/install_xrce_agent.sh
source ros_ws/install/setup.bash
```

This produces `MicroXRCEAgent` on `PATH`, which `scripts/launch_sim.sh` invokes natively (no Docker needed for the DDS agent).

For the rest of the workspace:

```bash
cd ros_ws
colcon build --symlink-install
source install/setup.bash
```

### 3. Frontend dependencies

```bash
cd frontend
npm install
```

---

## Running

Each component runs in its own terminal. Source the ROS workspace (`source ros_ws/install/setup.bash`) in every ROS terminal.

### Simulator

```bash
bash scripts/launch_sim.sh
```

Starts Gazebo Harmonic headlessly (xvfb-run) and bridges `/camera/image_raw` into ROS 2.

### Infrastructure services (vLLM)

```bash
docker compose -f middleware/docker-compose.yml up
```

Starts the Qwen3-VL vLLM inference server on **port 8000**. The Micro-XRCE-DDS agent on **port 8888** is launched natively by `scripts/launch_sim.sh` (see [Setup §2](#2-build-ros-workspace)).

### Video streamer + rosbridge

```bash
bash scripts/launch_bridge.sh
```

Serves MJPEG at `http://localhost:8080/video`, single-frame snapshots at `/snapshot`, and WebRTC signaling at `/offer`. Also starts rosbridge_server on WebSocket port 9090.

### ROS nodes

```bash
ros2 run vlm_agent agent_node
ros2 run mission_control mission_node
```

### Frontend

```bash
cd frontend
npm run dev
```

Dashboard available at `http://localhost:3000`.

---

## Key Network Ports

| Port | Service |
|---|---|
| 3000 | Next.js dashboard |
| 8000 | vLLM REST API (OpenAI-compatible) |
| 8080 | MJPEG stream / WebRTC signaling |
| 8888/udp | Micro-XRCE-DDS (PX4 ↔ ROS 2) |
| 9090 | rosbridge_server (WebSocket, planned) |

---

## ROS Topics

| Topic | Type | Publisher | Subscriber |
|---|---|---|---|
| `/camera/image_raw` | `sensor_msgs/Image` | ros_gz_bridge | vlm_agent, webrtc_streamer |
| `/vlm/target_detections` | `std_msgs/String` (JSON) | vlm_agent | mission_control |

Detection message schema:

```json
{
  "target": "person wearing a red jacket",
  "bbox": [100, 150, 200, 300],
  "confidence": 0.95
}
```

---

## Roadmap

- [ ] Wire `vlm_agent` to the local vLLM REST API (`http://localhost:8000/v1/chat/completions`)
- [ ] Implement waypoint generation in `mission_control` from VLM detections
- [ ] Integrate PX4 SITL with Gazebo (attach flight dynamics to the drone model)
- [ ] Connect `roslib.js` in the frontend to live ROS topics via `rosbridge_server`
- [ ] Promote drone from static SDF model to a dynamic PX4-controlled model
- [ ] Write ROS 2 unit tests for VLM response parsing
- [ ] Natural language command translation (e.g. "Search northern perimeter") → waypoint path
