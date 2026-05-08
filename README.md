# ASAR — Autonomous Search and Rescue Simulation Framework

A simulation framework for autonomous drone-based search and rescue, combining a high-fidelity Gazebo environment, a PX4 autopilot, a locally-hosted Vision Language Model (VLM), and a real-time web dashboard.

> **Hardware Target**: AMD MI300X (~192 GB VRAM). The entire stack — simulator, VLM inference, and middleware — runs on ROCm and standard graphics APIs (Vulkan). No NVIDIA CUDA dependency.

---

## Architecture

The core design principle is a **Reason-Act-Observe** loop, which reconciles the high latency of VLM inference with the hard real-time requirements of drone flight control. Perception is split into two stages — a fast open-vocabulary detector (GroundingDINO / YOLO-World) for screening and Qwen3-VL for confirmation and target-status reasoning. Both run on a remote MI300X host reached over a Tailscale tailnet.

```
sim-host  (this repo)                              vlm-host  (MI300X)
┌──────────────────────────────────────┐           ┌──────────────────────────────┐
│            Next.js Dashboard         │           │  GroundingDINO / YOLO-World  │
│  Video │ Map │ Tel │ Agent Log │ SAR │           │       (port 8001)            │
└──────────────────────┬───────────────┘           │                              │
        roslib (WS)    │   WebRTC                  │  vLLM + Qwen3-VL-235B        │
        ───────────────┤────────────────           │       (port 8000)            │
                       │ rosbridge + webrtc        │                              │
                ROS 2 Jazzy (DDS)                  └──────────────┬───────────────┘
   ┌──────────┬────────┴────────┬─────────────┐                   │
   │          │                 │             │                   │ HTTP/JSON
sar_agent  mission_manager  mission_control  ros_gz_bridge        │ over
(Briefing→ (records target  (PX4 flight     (Gazebo ↔ ROS)        │ Tailscale
 Plan→     status; drives    executor)                            │
 Recon→    Secure-Target           │              │               │
 Acquire→  hover)                  │       Gazebo Harmonic        │
 Secure)        │                  │       asar_world.sdf         │
   │     /mission/target_status    │                              │
   │       (latched topic)         │                              │
   └─── HTTPS over Tailscale ──────┴──────────────────────────────┘
```

| Phase | Component | Frequency |
|---|---|---|
| **Observe** | `sar_agent` captures `/camera/image_raw` and screens with the detector | 3–5 Hz |
| **Reason** | Qwen3-VL confirms target and produces structured status | Async, on positive screening |
| **Act** | `mission_node` (PX4 AUTO_LOITER + REPOSITION) executes waypoints | 50 Hz+ |

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
│   ├── docker-compose.yml      # XRCE-DDS legacy (now native via launch_sim.sh)
│   ├── webrtc_streamer.py      # MJPEG + WebRTC signaling server (port 8080)
│   └── webrtc_streamer_backup.py
│
├── perception_server/          # MI300X-side: vLLM (Qwen3-VL) + GroundingDINO
│   ├── detector_server.py      # FastAPI /detect endpoint (port 8001)
│   ├── docker-compose.yml      # Brings up vllm:8000 + detector:8001
│   ├── Dockerfile              # ROCm PyTorch base for the detector
│   └── requirements.txt
│
├── scripts/
│   ├── launch_sim.sh           # Headless Gazebo + PX4 SITL + ros_gz_bridge
│   ├── launch_bridge.sh        # rosbridge_server + webrtc_streamer
│   ├── install_xrce_agent.sh   # Builds Micro-XRCE-DDS-Agent v2.4.3 into ros_ws
│   └── install_rosbridge.sh    # Builds rosbridge into ros_ws
│
├── ros_ws/
│   └── src/
│       ├── asar_msgs/          # Custom MissionBriefing, TargetStatus, RecordTargetStatus
│       ├── sar_agent/          # Autonomous SAR orchestrator (planner + perception client)
│       ├── mission_manager/    # /mission/record_target_status service + Secure-Target hover
│       └── mission_control/    # PX4 flight executor (mission_node + teleop_node)
│
├── frontend/
│   └── src/
│       ├── app/page.tsx        # Main dashboard layout
│       └── components/
│           ├── VideoPlayer.tsx         # Snapshot-polling fallback
│           ├── VideoPlayerWebRTC.tsx   # WebRTC peer stream + bbox overlay
│           ├── MissionMap.tsx          # Leaflet map: GPS + waypoints + search disk + target
│           ├── TelemetryDashboard.tsx  # Altitude, speed, battery
│           ├── VLMConsole.tsx          # /sar/agent_log reason/act feed
│           ├── BriefingPanel.tsx       # Publishes /sar/briefing (target, area, optional clue image)
│           ├── SARStatusBadge.tsx      # Header pill, subscribes /sar/state
│           └── TargetStatusCard.tsx    # Renders /mission/target_status
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
| `mission_control` (mission_node + teleop_node) | **Complete** — AUTO_LOITER + REPOSITION |
| `sar_agent` autonomous orchestrator | **Implemented** — needs live perception backend |
| `mission_manager` target-status service | **Implemented** — drives Secure-Target hover |
| Two-stage perception backend (detector + VLM) on MI300X | **Implemented** — vLLM compose + GroundingDINO server in [perception_server/](perception_server/) |
| PX4 SITL integration | **Complete** |
| Frontend dashboard | **Complete** — Briefing panel, search-disk overlay, agent-log feed, bbox video overlay, target-status card |

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

`scripts/launch_bridge.sh` already starts `mission_node`, `teleop_node`, `mission_manager`, and `sar_agent`. To run a single node ad-hoc:

```bash
ros2 run mission_control mission_node
ros2 run mission_control teleop_node
ros2 run mission_manager mission_manager_node
VLM_BASE_URL=http://vlm-host:8000 DETECTOR_URL=http://vlm-host:8001 ros2 run sar_agent agent_node
```

### Kicking off a SAR mission

From the dashboard, switch to the **SAR** tab and use the Briefing form. Or from the CLI:

```bash
ros2 topic pub --once /sar/briefing asar_msgs/msg/MissionBriefing \
  "{target_description: 'red cylinder', \
    search_center_lat: 47.397971, search_center_lon: 8.546164, \
    search_radius_m: 15.0, search_altitude_m: 8.0}"
```

The agent transitions IDLE → BRIEFING → PLANNING → SEARCHING → CONFIRMING → SECURED. Watch progress with `ros2 topic echo /sar/agent_log`, or in the dashboard:

- **Header badge** shows the live agent state.
- **Mission Map** draws the search disk + lawn-mower path, then drops a pulsing red marker on target.
- **Video** overlays the detector's bbox + label/confidence in real time.
- **Agent Log tab** prints color-coded state changes, tool calls, detections, and VLM rationales.
- **SAR tab** holds the briefing form on top and the target-status card below (populated after acquisition).

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

## ROS Topics & Services

| Topic / Service | Type | Publisher / Server | Subscriber / Client |
|---|---|---|---|
| `/camera/image_raw` | `sensor_msgs/Image` | ros_gz_bridge | sar_agent, webrtc_streamer |
| `/sar/briefing` | `asar_msgs/MissionBriefing` | frontend / CLI | sar_agent |
| `/sar/state` (latched) | `std_msgs/String` | sar_agent | frontend |
| `/sar/agent_log` | `std_msgs/String` (JSON) | sar_agent | frontend |
| `/sar/planned_waypoints` (latched) | `std_msgs/String` (JSON) | sar_agent | frontend |
| `/sar/detection_overlay` | `std_msgs/String` (JSON) | sar_agent | frontend |
| `/mission/goto` | `geometry_msgs/PoseStamped` (ENU) | sar_agent, mission_manager, frontend | mission_node |
| `/mission/target_status` (latched) | `asar_msgs/TargetStatus` | mission_manager | frontend |
| `/mission/record_target_status` | `asar_msgs/srv/RecordTargetStatus` | mission_manager | sar_agent |

Agent-log entry schema:

```json
{"ts": 1714600000.123, "kind": "state|tool_call|tool_result|vlm_reason|detection|error",
 "state": "SEARCHING", "data": {...}}
```

---

## Perception Server (MI300X / Tailscale)

The MI300X-side code lives in [perception_server/](perception_server/) and is deployed with its own docker-compose. It runs two services:

| Service | Port | What it is | Custom code? |
|---|---|---|---|
| **vLLM (Qwen3-VL)** | 8000 | OpenAI-compatible chat completions with vision | No — `vllm serve` is sufficient |
| **GroundingDINO detector** | 8001 | Open-vocabulary `/detect` endpoint (FastAPI wrapper) | [detector_server.py](perception_server/detector_server.py) |

`sar_agent` on the sim host reads `VLM_BASE_URL` and `DETECTOR_URL` from the environment. Defaults: `http://vlm-host:8000` and `http://vlm-host:8001`.

### Wire protocol

- **Detector** — `POST $DETECTOR_URL/detect` (multipart): `image` (JPEG bytes) + `prompt` (text). Response: `{"detections": [{"label": "...", "bbox": [x, y, w, h], "confidence": 0.0-1.0}, ...]}`. Healthcheck: `GET /healthz`.
- **VLM** — `POST $VLM_BASE_URL/v1/chat/completions` (OpenAI-compatible) with an `image_url` content block (data-URL JPEG). Used by `sar_agent` for two prompts:
  - *Briefing* — derive a target description from a clue image.
  - *Confirmation* — verify the target and emit JSON `{found, health, terrain, distance_to_safety_m, confidence, rationale}`.

### Deploying on the MI300X

```bash
# 0. Tailscale on both hosts
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=vlm-host    # on MI300X
sudo tailscale up --hostname=sim-host    # on the sim host

# 1. Bring up vLLM + detector
cd perception_server
docker compose up -d --build

# 2. Verify from sim-host
curl http://vlm-host:8000/v1/models
curl http://vlm-host:8001/healthz

# 3. (Optional) Lock ports to sim-host identity via Tailscale ACL JSON
#    {"acls": [{"action": "accept", "src": ["sim-host"],
#              "dst": ["vlm-host:8000,8001"]}]}
```

The detector image is built from [perception_server/Dockerfile](perception_server/Dockerfile) on top of the ROCm PyTorch base. To run the detector standalone (no Docker, e.g. on a CPU dev box):

```bash
cd perception_server
pip install -r requirements.txt
# torch comes from your platform-specific wheel; on CPU:
pip install torch --index-url https://download.pytorch.org/whl/cpu
python3 detector_server.py
```

---

## Roadmap

- [ ] Camera-intrinsics-aware ground-projection so target lat/lon comes from the bbox center, not the drone position
- [ ] Tailscale ACL hardening + `tailscale serve` HTTPS termination
- [ ] Promote sar_agent to a VLM tool-calling driven loop (use TOOL_SCHEMAS in `sar_agent.tools`)
- [ ] Real-world tuning of GroundingDINO thresholds against drone-altitude footage
