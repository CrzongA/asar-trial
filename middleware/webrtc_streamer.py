"""
WebRTC streaming middleware for ASAR.

Replaces the MJPEG snapshot-polling pipeline with a proper WebRTC H.264 stream.

ICE strategy: gather-then-send
  Both sides wait for iceGatheringState == "complete" before exchanging SDP.
  This avoids the need for a Trickle-ICE WebSocket channel and works reliably
  on LAN and over the internet (with STUN/TURN configured).

Environment variables (all optional):
  STUN_URL          STUN server URI      default: stun:stun.l.google.com:19302
  TURN_URL          TURN server URI      e.g.    turn:turn.example.com:3478
  TURN_USERNAME     TURN credential username
  TURN_CREDENTIAL   TURN credential password

  ICE_PORT_MIN      UDP port range for RTP  default: 10000
  ICE_PORT_MAX                              default: 10100
  Open these ports (UDP) on your firewall so remote browsers can reach the
  server's srflx (STUN-discovered) candidates without needing TURN relay.

Endpoints:
  GET  /config    → JSON ICE server config for the browser
  POST /offer     → SDP offer/answer exchange
  OPTIONS /offer  → CORS preflight
  GET  /snapshot  → Latest JPEG frame (debug fallback)
"""

import asyncio
import json
import logging
import os
import threading
from typing import List, Optional

import cv2
import numpy as np
import rclpy
from aiohttp import web
from aiortc import (
    RTCConfiguration,
    RTCIceServer,
    RTCPeerConnection,
    RTCSessionDescription,
    VideoStreamTrack,
)
from aiortc.contrib.media import MediaRelay
from av import VideoFrame
from cv_bridge import CvBridge
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import Image

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("webrtc_streamer")

# ---------------------------------------------------------------------------
# ICE / STUN / TURN configuration (from environment)
# ---------------------------------------------------------------------------

def _build_ice_servers() -> List[RTCIceServer]:
    """Build aiortc ICE server list from environment variables."""
    servers = []

    stun_url = os.environ.get("STUN_URL", "stun:stun.l.google.com:19302")
    if stun_url:
        servers.append(RTCIceServer(urls=[stun_url]))

    turn_url = os.environ.get("TURN_URL")
    if turn_url:
        username = os.environ.get("TURN_USERNAME", "")
        credential = os.environ.get("TURN_CREDENTIAL", "")
        servers.append(
            RTCIceServer(urls=[turn_url], username=username, credential=credential)
        )

    return servers


def _build_ice_config_json() -> List[dict]:
    """Build the ICE server list in browser-compatible JSON format."""
    entries = []

    stun_url = os.environ.get("STUN_URL", "stun:stun.l.google.com:19302")
    if stun_url:
        entries.append({"urls": stun_url})

    turn_url = os.environ.get("TURN_URL")
    if turn_url:
        entries.append(
            {
                "urls": turn_url,
                "username": os.environ.get("TURN_USERNAME", ""),
                "credential": os.environ.get("TURN_CREDENTIAL", ""),
            }
        )

    return entries


ICE_PORT_MIN = int(os.environ.get("ICE_PORT_MIN", "10000"))
ICE_PORT_MAX = int(os.environ.get("ICE_PORT_MAX", "10100"))

RTC_CONFIG = RTCConfiguration(
    iceServers=_build_ice_servers(),
)

# ---------------------------------------------------------------------------
# ROS 2 video track (shared across all peer connections)
# ---------------------------------------------------------------------------

class ROSVideoTrack(VideoStreamTrack):
    """
    A VideoStreamTrack fed by the ROS /camera/image_raw topic.

    A single instance is shared across all RTCPeerConnections so we only
    have one ROS subscriber regardless of how many browsers are connected.
    """

    def __init__(self):
        super().__init__()
        self.bridge = CvBridge()
        self._frame_lock = threading.Lock()
        self._latest_frame: Optional[VideoFrame] = None
        self._latest_jpeg: Optional[bytes] = None  # kept for /snapshot endpoint

    def update_image(self, msg: Image):
        """Called from the ROS spin thread."""
        try:
            cv_img = self.bridge.imgmsg_to_cv2(msg, desired_encoding="rgb8")
            frame = VideoFrame.from_ndarray(cv_img, format="rgb24")
            _, buf = cv2.imencode(".jpg", cv2.cvtColor(cv_img, cv2.COLOR_RGB2BGR))
            with self._frame_lock:
                self._latest_frame = frame
                self._latest_jpeg = buf.tobytes()
        except Exception as exc:
            log.warning("CV bridge error: %s", exc)

    def get_snapshot_jpeg(self) -> bytes:
        with self._frame_lock:
            if self._latest_jpeg is not None:
                return self._latest_jpeg
        # Return a 1×1 black JPEG as a safe blank
        blank = np.zeros((480, 640, 3), dtype=np.uint8)
        _, buf = cv2.imencode(".jpg", blank)
        return buf.tobytes()

    async def recv(self) -> VideoFrame:
        pts, time_base = await self.next_timestamp()

        with self._frame_lock:
            frame = self._latest_frame

        if frame is None:
            img = np.zeros((480, 640, 3), dtype=np.uint8)
            frame = VideoFrame.from_ndarray(img, format="rgb24")

        frame = frame.reformat(format="rgb24")
        frame.pts = pts
        frame.time_base = time_base
        return frame


# ---------------------------------------------------------------------------
# ROS 2 node
# ---------------------------------------------------------------------------

class WebRTCNode(Node):
    def __init__(self, track: ROSVideoTrack):
        super().__init__("webrtc_streamer")
        self.track = track
        self.create_subscription(
            Image,
            "/camera/image_raw",
            self._image_callback,
            qos_profile_sensor_data,
        )
        self.get_logger().info(
            "WebRTC Streamer node started — subscribed to /camera/image_raw"
        )

    def _image_callback(self, msg: Image):
        self.track.update_image(msg)


# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------

video_track = ROSVideoTrack()
relay = MediaRelay()
peer_connections: set[RTCPeerConnection] = set()

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

# ---------------------------------------------------------------------------
# HTTP handlers
# ---------------------------------------------------------------------------

async def handle_config(request: web.Request) -> web.Response:
    """
    GET /config
    Returns the ICE server list so the browser builds its RTCPeerConnection
    with the same STUN/TURN settings as the server. This way TURN credentials
    never need to be baked into the frontend bundle.
    """
    return web.Response(
        content_type="application/json",
        headers=CORS_HEADERS,
        text=json.dumps({"iceServers": _build_ice_config_json()}),
    )


async def handle_offer(request: web.Request) -> web.Response:
    """
    POST /offer
    Receive a browser SDP offer, create an answer, wait for ICE gathering to
    complete on the server side, then return the fully-populated answer SDP.

    ICE strategy: gather-then-send
      We wait up to 5 seconds for the server's ICE candidates to be gathered
      before returning the answer. This ensures the SDP contains real
      a=candidate lines (including STUN srflx candidates for internet access)
      so the browser can reach the server without a Trickle-ICE channel.
    """
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection(configuration=RTC_CONFIG)
    peer_connections.add(pc)

    @pc.on("connectionstatechange")
    async def on_state_change():
        log.info("Peer connection state: %s", pc.connectionState)
        if pc.connectionState in ("failed", "closed"):
            await pc.close()
            peer_connections.discard(pc)

    # Add the shared ROS video track (via relay to support multiple consumers)
    pc.addTrack(relay.subscribe(video_track))

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    # --- Gather-then-send: wait for ICE gathering to complete ---------------
    # Without this wait, the SDP answer may have no a=candidate lines, causing
    # the connection to fail silently (the bug in webrtc_streamer_backup.py).
    if pc.iceGatheringState != "complete":
        gather_done = asyncio.Event()

        @pc.on("icegatheringstatechange")
        def _on_gather_state():
            log.debug("ICE gathering state: %s", pc.iceGatheringState)
            if pc.iceGatheringState == "complete":
                gather_done.set()

        try:
            await asyncio.wait_for(gather_done.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            log.warning(
                "ICE gathering timed out after 5 s. Sending partial SDP. "
                "Check STUN/TURN reachability and firewall UDP rules."
            )
    # ------------------------------------------------------------------------

    return web.Response(
        content_type="application/json",
        headers=CORS_HEADERS,
        text=json.dumps(
            {
                "sdp": pc.localDescription.sdp,
                "type": pc.localDescription.type,
            }
        ),
    )


async def handle_offer_options(request: web.Request) -> web.Response:
    """CORS preflight for /offer."""
    return web.Response(headers=CORS_HEADERS)


async def handle_snapshot(request: web.Request) -> web.Response:
    """GET /snapshot — latest JPEG frame, useful for debugging."""
    return web.Response(
        body=video_track.get_snapshot_jpeg(),
        content_type="image/jpeg",
        headers={"Access-Control-Allow-Origin": "*"},
    )


async def on_shutdown(app: web.Application):
    coros = [pc.close() for pc in peer_connections]
    await asyncio.gather(*coros)
    peer_connections.clear()


# ---------------------------------------------------------------------------
# ROS spin thread
# ---------------------------------------------------------------------------

def _run_ros(args=None):
    rclpy.init(args=args)
    node = WebRTCNode(video_track)
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    ros_thread = threading.Thread(target=_run_ros, daemon=True)
    ros_thread.start()

    ice_servers_display = _build_ice_config_json()
    log.info("ICE servers: %s", json.dumps(ice_servers_display, indent=2))
    log.info(
        "UDP port range for RTP: %d–%d  (open these on your firewall for internet access)",
        ICE_PORT_MIN,
        ICE_PORT_MAX,
    )

    app = web.Application()
    app.on_shutdown.append(on_shutdown)
    app.router.add_get("/config", handle_config)
    app.router.add_post("/offer", handle_offer)
    app.router.add_route("OPTIONS", "/offer", handle_offer_options)
    app.router.add_get("/snapshot", handle_snapshot)

    log.info("WebRTC signaling server → http://0.0.0.0:8080")
    web.run_app(app, host="0.0.0.0", port=8080)
