# ASAR — Autonomous Search and Rescue Simulation Framework

A simulation framework for autonomous drone-based search and rescue, combining a high-fidelity Gazebo environment, a PX4 autopilot, a locally-hosted Vision Language Model (VLM), and a real-time web dashboard.

> **Hardware Target**: AMD MI300X (~192 GB VRAM). The entire stack — simulator, VLM inference, and middleware — runs on ROCm and standard graphics APIs (Vulkan). No NVIDIA CUDA dependency.

---

## Architecture

The core design principle is a **Reason-Act-Observe** loop, which reconciles the high latency of VLM inference with the hard real-time requirements of drone flight control. Perception is split into two stages — a fast open-vocabulary detector (GroundingDINO / YOLO-World) for screening and Qwen2.5-VL for confirmation and target-status reasoning. Both run on a remote MI300X host reached over a Tailscale tailnet.

```
sim-host  (this repo)                              vlm-host  (MI300X)
┌──────────────────────────────────────┐           ┌──────────────────────────────┐
│            Next.js Dashboard         │           │  GroundingDINO / YOLO-World  │
│  Video │ Map │ Tel │ Agent Log │ SAR │           │       (port 8001)            │
│  Reset │ RTL │ Land │ Action Bar     │           │                              │
└──────────────────────┬───────────────┘           │  vLLM + Qwen2.5-VL-72B       │
        roslib (WS)    │   WebRTC                  │       (port 8000)            │
        ───────────────┤────────────────           │                              │
                       │ rosbridge + webrtc        │                              │
                ROS 2 Jazzy (DDS)                  └──────────────┬───────────────┘
   ┌──────────┬────────┴────────┬─────────────┐                   │
   │          │                 │             │                   │ HTTP/JSON
sar_agent  mission_manager  mission_control  ros_gz_bridge        │ over
(Briefing→ (records target  (PX4 flight     (Gazebo ↔ ROS)        │ Tailscale
 Plan→     status; drives    executor)                            │
 Recon→    Secure-Target           │              │               │
 Acquire→  hover)                  │       Gazebo Harmonic        │
 Secure)        │                  │       rubicon.sdf            │
   │     /mission/target_status    │                              │
   │       (latched topic)         │                              │
   └─── HTTPS over Tailscale ──────┴──────────────────────────────┘
```

| Phase | Component | Frequency |
|---|---|---|
| **Observe** | `sar_agent` captures `/camera/image_raw` and screens with the detector | 3–5 Hz |
| **Reason** | Qwen2.5-VL confirms target and produces structured status | Async, on positive screening |
| **Act** | `mission_node` (PX4 AUTO_LOITER + REPOSITION) executes waypoints | 50 Hz+ |

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Simulator | Gazebo Harmonic + Ogre2 | Vulkan rendering, AMD-friendly |
| Flight Stack | PX4 SITL + Micro-XRCE-DDS | Realistic flight dynamics |
| Middleware | ROS 2 Jazzy | LTS; handles all inter-process comms |
| VLM Inference | Qwen2.5-VL-72B-Instruct via vLLM | ROCm Native; OpenAI-compatible API |
| Video Stream | aiortc WebRTC (H.264) | Gather-then-send ICE strategy |
| Frontend | Next.js 15 / React 19 / Tailwind CSS 4 | TypeScript throughout |
| Mapping | Leaflet + react-leaflet | GPS track and VLM waypoint markers |

---

## Repository Layout

```
asar-trial/
├── sim/
│   ├── rubicon.sdf             # Default world: desert terrain with obstacles
│   ├── asar_world.sdf          # Flat world: ground plane, red-target cylinder
│   └── models/                 # Custom Gazebo models (asar_drone wraps x500_gimbal)
│
├── middleware/
│   ├── webrtc_streamer.py      # WebRTC signaling server (port 8080)
│   └── webrtc_streamer_backup.py
│
├── perception_server/          # MI300X-side: vLLM (Qwen2.5-VL) + GroundingDINO
│   ├── detector_server.py      # FastAPI /detect endpoint (port 8001)
│   ├── docker-compose.yml      # Brings up vllm:8000 + detector:8001
│   ├── Dockerfile              # ROCm PyTorch base for the detector
│   └── requirements.txt
│
├── scripts/
│   ├── launch_sim.sh           # Headless Gazebo (EGL) + PX4 SITL + ros_gz_bridge
│   ├── launch_bridge.sh        # rosbridge_server + webrtc_streamer + ROS nodes
│   ├── install_xrce_agent.sh   # Builds Micro-XRCE-DDS-Agent v2.4.3 into ros_ws
│   ├── install_rosbridge.sh    # Builds rosbridge into ros_ws
│   └── set_target.py           # Dynamically moves the red capsule target (snaps to ground)
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
│           ├── ActionBar.tsx           # Arm/Disarm, Land, RTL, and Reset controls
│           ├── StatusMessageHub.tsx    # Centralized aircraft status notifications
│           ├── VideoPlayerWebRTC.tsx   # WebRTC peer stream + bbox overlay
│           ├── MissionMap.tsx          # Leaflet map: GPS + waypoints + search disk + target
│           ├── TelemetryDashboard.tsx  # Altitude, speed, battery, and PX4 flags
│           ├── VLMConsole.tsx          # /sar/agent_log reason/act feed
│           ├── BriefingPanel.tsx       # Publishes /sar/briefing (target, area, clue image)
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
| Gazebo world (multiple worlds, gimbal cam) | **Complete** |
| Headless sim launcher (EGL acceleration) | **Complete** |
| ros_gz_bridge (Image + Clock + Gimbal) | **Complete** |
| WebRTC streamer (ICE port ranges) | **Complete** |
| `mission_control` (AUTO flow + Braking + Reset) | **Complete** |
| `sar_agent` autonomous orchestrator | **Implemented** |
| `mission_manager` target-status service | **Implemented** |
| Two-stage perception backend (MI300X) | **Implemented** |
| PX4 SITL integration (Standalone mode) | **Complete** |
| Frontend dashboard (Status Hub + Action Bar) | **Complete** |

---

## Prerequisites

- ROS 2 Jazzy
- Gazebo Harmonic (`gz-harmonic`)
- `ros-jazzy-ros-gz-bridge`
- Docker + Docker Compose (for MI300X backend)
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

This produces `MicroXRCEAgent` on `PATH`, which `scripts/launch_sim.sh` invokes natively.

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

Starts Gazebo Harmonic headlessly with EGL hardware acceleration and bridges topics into ROS 2. Set `WORLD=asar_world` for the flat testing environment.

### Infrastructure services (vLLM + Detector)

```bash
cd perception_server
docker compose up -d
```

Starts the Qwen2.5-VL vLLM server on **port 8000** and the GroundingDINO detector on **port 8001**.

### Video streamer + rosbridge + ROS nodes

```bash
bash scripts/launch_bridge.sh
```

Starts `mission_node`, `teleop_node`, `mission_manager`, `sar_agent`, `rosbridge_server` (port 9090), and the `webrtc_streamer` (port 8080).

### Kicking off a SAR mission

From the dashboard, switch to the **SAR** tab and use the Briefing form. Or from the CLI:

```bash
ros2 topic pub --once /sar/briefing asar_msgs/msg/MissionBriefing \
  "{target_description: 'red cylinder', \
    search_center_lat: 47.397971, search_center_lon: 8.546164, \
    search_radius_m: 15.0, search_altitude_m: 8.0}"
```

The agent transitions IDLE → BRIEFING → PLANNING → SEARCHING → CONFIRMING → SECURED. Watch progress in the dashboard:

- **Header badge** shows the live agent state.
- **Mission Map** draws the search disk + lawn-mower path.
- **Video** overlays the detector's bbox + label/confidence in real time.
- **Status Hub** shows mission progress and failsafe notifications.
- **Action Bar** provides manual overrides (RTL, Land, Reset).

### Frontend

```bash
cd frontend
npm run dev
```

Dashboard available at `http://localhost:3000`.

### Controlling the Mock Target

The `rubicon` world includes a mock target (a red capsule). You can dynamically move it while the simulation is running to test the perception and autonomous flight pipelines:

```bash
# Usage: ./scripts/set_target.py <x> <y> [offset_z]
./scripts/set_target.py 10.5 -4.2
```

The script automatically reads the terrain's heightmap and snaps the capsule to the ground at a realistic altitude.

---

## Key Network Ports

| Port | Service |
|---|---|
| 3000 | Next.js dashboard |
| 8000 | vLLM REST API (OpenAI-compatible) |
| 8080 | WebRTC signaling server |
| 8888/udp | Micro-XRCE-DDS (PX4 ↔ ROS 2) |
| 9090 | rosbridge_server (WebSocket) |

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
| `/mission/land` | `std_msgs/Empty` | frontend / ActionBar | mission_node |
| `/mission/rtl` | `std_msgs/Empty` | frontend / ActionBar | mission_node |
| `/mission/reset` | `std_msgs/Empty` | frontend / ActionBar | mission_node |
| `/mission/cancel` | `std_msgs/Empty` | frontend | mission_node |
| `/mission/status_text` | `std_msgs/String` | mission_node | frontend / StatusHub |
| `/mission/target_status` (latched) | `asar_msgs/TargetStatus` | mission_manager | frontend |
| `/mission/record_target_status` | `asar_msgs/srv/RecordTargetStatus` | mission_manager | sar_agent |
| `/gimbal/pitch`, `/gimbal/yaw` | `std_msgs/Float64` | teleop_node | ros_gz_bridge |

Agent-log entry schema:

```json
{"ts": 1714600000.123, "kind": "state|tool_call|tool_result|vlm_reason|detection|error",
 "state": "SEARCHING", "data": {...}}
```

---

## Perception Server (MI300X / Tailscale)

The MI300X-side code lives in [perception_server/](perception_server/) and runs two services:

| Service | Port | What it is |
|---|---|---|
| **vLLM (Qwen2.5-VL)** | 8000 | OpenAI-compatible vision chat completions |
| **GroundingDINO detector** | 8001 | Open-vocabulary `/detect` endpoint |

`sar_agent` reads `VLM_BASE_URL` and `DETECTOR_URL` from the environment. Defaults: `http://vlm-host:8000` and `http://vlm-host:8001`.

### Wire protocol

- **Detector** — `POST $DETECTOR_URL/detect` (multipart): `image` (JPEG bytes) + `prompt` (text). Response: `{"detections": [{"label": "...", "bbox": [x, y, w, h], "confidence": 0.0-1.0}, ...]}`. Healthcheck: `GET /healthz`.
- **VLM** — `POST $VLM_BASE_URL/v1/chat/completions` (OpenAI-compatible) with an `image_url` content block (data-URL JPEG). Used by `sar_agent` for two prompts:
  - *Briefing* — derive a target description from a clue image.
  - *Confirmation* — verify the target and emit JSON `{found, health, terrain, distance_to_safety_m, confidence, rationale}`.

### Deploying on the MI300X (Docker)

The perception services are containerized for easy deployment on the MI300X host.

```bash
# 0. Tailscale on both hosts
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=vlm-host    # on MI300X
sudo tailscale up --hostname=sim-host    # on the sim host

# 1. Launch services with Docker Compose
cd perception_server
docker compose up -d

# 2. Verify from sim-host
curl http://vlm-host:8000/v1/models      # vLLM check
curl http://vlm-host:8001/healthz        # Detector check
```

The `vllm` service pulls the official `rocm/vllm` image, while the `detector` service is built locally from [perception_server/Dockerfile](perception_server/Dockerfile). Both use `--network=host` to bind directly to the Tailscale IP.

#### Native / Developer Fallback

To run the detector standalone (e.g., on a CPU dev box without Docker):

```bash
cd perception_server
python3 -m venv .venv-perception
source .venv-perception/bin/activate
pip install -r requirements.txt
# On CPU, ensure a compatible torch version is installed:
# pip install torch --index-url https://download.pytorch.org/whl/cpu
python3 detector_server.py
```

---

## Roadmap

- [ ] Camera-intrinsics-aware ground-projection for target lat/lon
- [ ] Tailscale ACL hardening + HTTPS termination
- [ ] Promote `sar_agent` to a VLM tool-calling driven loop
- [ ] Real-world tuning of GroundingDINO thresholds against drone footage
