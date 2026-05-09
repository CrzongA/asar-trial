"""sar_agent: autonomous SAR mission orchestrator.

Lifecycle: IDLE -> BRIEFING -> PLANNING -> SEARCHING -> CONFIRMING -> SECURED.

Topics:
  in   /sar/briefing                 (asar_msgs/MissionBriefing)
  in   /camera/image_raw             (sensor_msgs/Image)
  in   /fmu/out/home_position_v1     (px4_msgs/HomePosition)
  in   /fmu/out/vehicle_local_position_v1 (px4_msgs/VehicleLocalPosition)
  in   /mission/target_status        (asar_msgs/TargetStatus, latched)
  out  /mission/goto                 (geometry_msgs/PoseStamped)
  out  /sar/state                    (std_msgs/String, latched)
  out  /sar/agent_log                (std_msgs/String JSON)
  out  /sar/planned_waypoints        (std_msgs/String JSON, latched)
  out  /sar/detection_overlay        (std_msgs/String JSON)
  out  /gimbal/pitch, /gimbal/yaw    (std_msgs/Float64 radians)
  in   /sar/control                  (std_msgs/String: abort|pause|resume)
  svc  /mission/record_target_status (asar_msgs/srv/RecordTargetStatus, client)
"""

from __future__ import annotations

import json
import math
import threading
import time
from dataclasses import asdict
from typing import Optional

import numpy as np
import rclpy
from asar_msgs.msg import MissionBriefing, TargetStatus
from asar_msgs.srv import RecordTargetStatus
from geometry_msgs.msg import PoseStamped
from px4_msgs.msg import HomePosition, VehicleLocalPosition
from rclpy.node import Node
from rclpy.qos import (
    DurabilityPolicy,
    HistoryPolicy,
    QoSProfile,
    ReliabilityPolicy,
)
from sensor_msgs.msg import Image
from std_msgs.msg import Float64, String

from .perception_client import Detection, PerceptionClient, TargetAssessment
from .planner import Waypoint, lawn_mower
from .state import AgentState
from .tools import ToolRegistry


PX4_QOS = QoSProfile(
    reliability=ReliabilityPolicy.BEST_EFFORT,
    durability=DurabilityPolicy.VOLATILE,
    history=HistoryPolicy.KEEP_LAST,
    depth=5,
)

LATCHED_QOS = QoSProfile(
    reliability=ReliabilityPolicy.RELIABLE,
    durability=DurabilityPolicy.TRANSIENT_LOCAL,
    history=HistoryPolicy.KEEP_LAST,
    depth=1,
)

PERCEPTION_HZ = 3.0
TICK_HZ = 5.0
DETECTION_CONF_THRESHOLD = 0.55
DETECTION_STREAK_REQUIRED = 3
WAYPOINT_REACHED_TOL_M = 3.0


def _ros_image_to_bgr(msg: Image) -> Optional[np.ndarray]:
    """Decode a sensor_msgs/Image to OpenCV BGR without cv_bridge."""
    if msg.width == 0 or msg.height == 0:
        return None
    encoding = msg.encoding.lower()
    buf = np.frombuffer(bytes(msg.data), dtype=np.uint8)
    if encoding in ('rgb8', 'bgr8'):
        try:
            arr = buf.reshape((msg.height, msg.width, 3))
        except ValueError:
            return None
        if encoding == 'rgb8':
            arr = arr[:, :, ::-1].copy()
        return arr
    if encoding == 'mono8':
        try:
            arr = buf.reshape((msg.height, msg.width))
        except ValueError:
            return None
        return np.stack([arr] * 3, axis=-1)
    return None


class SarAgentNode(Node):
    def __init__(self):
        super().__init__('sar_agent_node')

        self.state = AgentState.IDLE
        self.briefing: Optional[MissionBriefing] = None
        self.target_description = ''
        self.waypoints: list[Waypoint] = []
        self.active_waypoint_idx = -1
        self.detection_streak = 0
        self.last_detection: Optional[Detection] = None
        self.last_image: Optional[np.ndarray] = None
        self.last_image_lock = threading.Lock()
        self.home_lat: Optional[float] = None
        self.home_lon: Optional[float] = None
        self.home_alt: Optional[float] = None
        self.local_xy: tuple[float, float, float] | None = None
        self.confirming_started_ns = 0

        self.perception = PerceptionClient()
        self.tools = ToolRegistry()
        self._wire_tools()

        # Subs
        self.create_subscription(MissionBriefing, '/sar/briefing', self._on_briefing, 10)
        self.create_subscription(Image, '/camera/image_raw', self._on_image, 10)
        self.create_subscription(HomePosition, '/fmu/out/home_position_v1', self._on_home, PX4_QOS)
        self.create_subscription(VehicleLocalPosition, '/fmu/out/vehicle_local_position_v1', self._on_local, PX4_QOS)
        self.create_subscription(TargetStatus, '/mission/target_status', self._on_target_status, LATCHED_QOS)
        self.create_subscription(String, '/sar/control', self._on_control, 10)

        # Pubs
        self.pub_goto = self.create_publisher(PoseStamped, '/mission/goto', 10)
        self.pub_state = self.create_publisher(String, '/sar/state', LATCHED_QOS)
        self.pub_log = self.create_publisher(String, '/sar/agent_log', 10)
        self.pub_plan = self.create_publisher(String, '/sar/planned_waypoints', LATCHED_QOS)
        self.pub_overlay = self.create_publisher(String, '/sar/detection_overlay', 10)
        self.pub_gimbal_pitch = self.create_publisher(Float64, '/gimbal/pitch', 10)
        self.pub_gimbal_yaw = self.create_publisher(Float64, '/gimbal/yaw', 10)

        self.cli_record = self.create_client(RecordTargetStatus, '/mission/record_target_status')

        self.create_timer(1.0 / TICK_HZ, self._tick)
        self.create_timer(1.0 / PERCEPTION_HZ, self._perceive)

        self._publish_state()
        self._log('info', 'sar_agent initialized; awaiting briefing on /sar/briefing.')

    # ---- Tool wiring ------------------------------------------------------
    def _wire_tools(self) -> None:
        self.tools.register('goto_waypoint', self._tool_goto)
        self.tools.register('set_gimbal', self._tool_gimbal)
        self.tools.register('record_target_status', self._tool_record)
        self.tools.register('cancel_mission', self._tool_cancel)
        self.tools.register('land', self._tool_land)
        self.tools.register('report_progress', self._tool_report)

    def _tool_goto(self, *, lat: float, lon: float, altitude_m: float) -> dict:
        enu = self._global_to_enu(lat, lon, altitude_m)
        if enu is None:
            return {'ok': False, 'error': 'no home position'}
        east, north, up = enu
        msg = PoseStamped()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = 'map'
        msg.pose.position.x = east
        msg.pose.position.y = north
        msg.pose.position.z = up
        msg.pose.orientation.w = 1.0
        self.pub_goto.publish(msg)
        return {'ok': True, 'enu': [east, north, up]}

    def _tool_gimbal(self, *, pitch_rad: float, yaw_rad: float) -> dict:
        self.pub_gimbal_pitch.publish(Float64(data=float(pitch_rad)))
        self.pub_gimbal_yaw.publish(Float64(data=float(yaw_rad)))
        return {'ok': True}

    def _tool_record(self, **kwargs) -> dict:
        if not self.cli_record.service_is_ready():
            return {'ok': False, 'error': 'mission_manager service unavailable'}
        req = RecordTargetStatus.Request()
        req.found = bool(kwargs.get('found', False))
        req.health = str(kwargs.get('health', 'unknown'))
        req.terrain = str(kwargs.get('terrain', 'unknown'))
        req.distance_to_safety_m = float(kwargs.get('distance_to_safety_m', 0.0))
        req.latitude = float(kwargs.get('lat', 0.0))
        req.longitude = float(kwargs.get('lon', 0.0))
        req.altitude_m = float(kwargs.get('altitude_m', 0.0))
        req.confidence = float(kwargs.get('confidence', 0.0))
        req.vlm_rationale = str(kwargs.get('rationale', ''))
        future = self.cli_record.call_async(req)
        return {'ok': True, 'future': future}

    def _tool_cancel(self) -> dict:
        self._enter(AgentState.ABORTED)
        return {'ok': True}

    def _tool_land(self) -> dict:
        # mission_node listens on /mission/land (std_msgs/Empty). We avoid an
        # extra publisher and just emit a goto at current position with z=0.
        # For now, surface this as a log line for the operator to handle.
        self._log('action', 'Land requested. Operator must publish /mission/land.')
        return {'ok': True}

    def _tool_report(self, *, message: str) -> dict:
        self._log('info', message)
        return {'ok': True}

    # ---- Subscriptions ----------------------------------------------------
    def _on_briefing(self, msg: MissionBriefing) -> None:
        if self.state not in (AgentState.IDLE, AgentState.SECURED, AgentState.ABORTED):
            self._log('error', f'Briefing rejected; agent is {self.state.name}.')
            return
        self.briefing = msg
        self._enter(AgentState.BRIEFING)

    def _on_image(self, msg: Image) -> None:
        bgr = _ros_image_to_bgr(msg)
        if bgr is None:
            return
        with self.last_image_lock:
            self.last_image = bgr

    def _on_home(self, msg: HomePosition) -> None:
        self.home_lat, self.home_lon, self.home_alt = msg.lat, msg.lon, msg.alt

    def _on_local(self, msg: VehicleLocalPosition) -> None:
        self.local_xy = (msg.x, msg.y, msg.z)

    def _on_target_status(self, msg: TargetStatus) -> None:
        if msg.found and self.state in (AgentState.SEARCHING, AgentState.CONFIRMING, AgentState.PAUSED):
            self._enter(AgentState.SECURED)

    def _on_control(self, msg: String) -> None:
        cmd = msg.data.lower().strip()
        if cmd == 'abort':
            self._enter(AgentState.ABORTED)
        elif cmd == 'pause':
            if self.state in (AgentState.SEARCHING, AgentState.CONFIRMING):
                self._enter(AgentState.PAUSED)
        elif cmd == 'resume':
            if self.state == AgentState.PAUSED:
                # We don't know exactly where we were, but SEARCHING is the
                # safe fallback that will re-dispatch the current waypoint.
                self._enter(AgentState.SEARCHING)
                self._dispatch_waypoint()

    # ---- State transitions ------------------------------------------------
    def _enter(self, new_state: AgentState) -> None:
        if new_state == self.state:
            return
        self._log('state', f'{self.state.name} -> {new_state.name}')
        self.state = new_state
        self._publish_state()

        if new_state == AgentState.BRIEFING:
            self._do_briefing()
        elif new_state == AgentState.PLANNING:
            self._do_plan()
        elif new_state == AgentState.SEARCHING:
            self.active_waypoint_idx = 0
            self._dispatch_waypoint()
        elif new_state == AgentState.ABORTED:
            self._log('action', 'Mission aborted; holding position.')

    def _do_briefing(self) -> None:
        if self.briefing is None:
            self._enter(AgentState.IDLE)
            return
        desc = (self.briefing.target_description or '').strip()
        if not desc and self.briefing.clue_image.height > 0:
            try:
                clue = _ros_image_to_bgr(self.briefing.clue_image)
                if clue is not None:
                    desc = self.perception.describe_clue_image(clue)
                    self._log('vlm_reason', f'Derived target description: "{desc}"')
            except Exception as exc:
                self._log('error', f'Clue-image description failed: {exc}')
        if not desc:
            self._log('error', 'Briefing missing target_description and clue_image.')
            self._enter(AgentState.IDLE)
            return
        self.target_description = desc
        self._enter(AgentState.PLANNING)

    def _do_plan(self) -> None:
        if self.briefing is None:
            self._enter(AgentState.IDLE)
            return
        if self.home_lat is None:
            # No home yet; fall back to using the briefing center as the
            # local-frame anchor. PX4 publishes home before arming, so this
            # branch is mostly belt-and-suspenders.
            home_lat = self.briefing.search_center_lat
            home_lon = self.briefing.search_center_lon
        else:
            home_lat = self.home_lat
            home_lon = self.home_lon
        try:
            self.waypoints = lawn_mower(
                home_lat=home_lat,
                home_lon=home_lon,
                center_lat=self.briefing.search_center_lat,
                center_lon=self.briefing.search_center_lon,
                radius_m=self.briefing.search_radius_m,
                altitude_m=self.briefing.search_altitude_m,
            )
        except ValueError as exc:
            self._log('error', f'Planner rejected briefing: {exc}')
            self._enter(AgentState.ABORTED)
            return
        self._publish_plan()
        self._log('info', f'Planned {len(self.waypoints)} waypoints over '
                          f'r={self.briefing.search_radius_m:.0f}m at alt={self.briefing.search_altitude_m:.0f}m.')
        self._enter(AgentState.SEARCHING)

    def _dispatch_waypoint(self) -> None:
        if self.briefing is None:
            return
        if self.active_waypoint_idx >= len(self.waypoints):
            self._log('info', 'Search exhausted without acquisition.')
            self._enter(AgentState.ABORTED)
            return
        wp = self.waypoints[self.active_waypoint_idx]
        result = self.tools.dispatch(
            'goto_waypoint',
            lat=wp.lat,
            lon=wp.lon,
            altitude_m=wp.up_m,
        )
        self._log('tool_call', json.dumps({
            'tool': 'goto_waypoint',
            'idx': self.active_waypoint_idx,
            'lat': wp.lat,
            'lon': wp.lon,
            'altitude_m': wp.up_m,
            'result': {k: v for k, v in result.items() if k != 'future'},
        }))

    def _waypoint_reached(self) -> bool:
        if self.local_xy is None or self.active_waypoint_idx >= len(self.waypoints):
            return False
        wp = self.waypoints[self.active_waypoint_idx]
        # Convert NED local to ENU (east, north, up); see mission_node._enu_to_ned.
        east = self.local_xy[1]
        north = self.local_xy[0]
        dx = east - wp.east_m
        dy = north - wp.north_m
        return (dx * dx + dy * dy) ** 0.5 < WAYPOINT_REACHED_TOL_M

    # ---- Periodic ticks ---------------------------------------------------
    def _tick(self) -> None:
        if self.state == AgentState.PAUSED:
            return

        if self.state == AgentState.SEARCHING:
            if self._waypoint_reached():
                self.active_waypoint_idx += 1
                if self.active_waypoint_idx >= len(self.waypoints):
                    self._log('info', 'Search exhausted without acquisition.')
                    self._enter(AgentState.ABORTED)
                else:
                    self._dispatch_waypoint()
        elif self.state == AgentState.CONFIRMING:
            # 5 s timeout to fall back to searching if VLM fails repeatedly.
            now = self.get_clock().now().nanoseconds
            if now - self.confirming_started_ns > 8_000_000_000:
                self._log('error', 'Confirmation timed out; resuming search.')
                self.detection_streak = 0
                self._enter(AgentState.SEARCHING)
                self._dispatch_waypoint()

    def _perceive(self) -> None:
        if self.state not in (AgentState.SEARCHING, AgentState.CONFIRMING):
            return
        if self.state == AgentState.PAUSED:
            return

        with self.last_image_lock:
            frame = None if self.last_image is None else self.last_image.copy()
        if frame is None:
            return

        if self.state == AgentState.SEARCHING:
            try:
                detections = self.perception.detect(frame, self.target_description)
            except Exception as exc:
                err_msg = str(exc)
                if hasattr(exc, 'response') and exc.response:
                    try:
                        # Try to capture the server-side error body (traceback)
                        body = exc.response.text
                        err_msg += f" | Response: {body[:200]}"
                    except:
                        pass
                self._log('error', f'Detector call failed: {err_msg}')
                return
            best = max(detections, key=lambda d: d.confidence, default=None)
            if best is not None:
                self._publish_overlay(best, frame.shape[1], frame.shape[0])
                if best.confidence >= DETECTION_CONF_THRESHOLD:
                    self.detection_streak += 1
                    self.last_detection = best
                    self._log('detection', json.dumps({
                        'label': best.label,
                        'bbox': list(best.bbox),
                        'confidence': best.confidence,
                        'streak': self.detection_streak,
                    }))
                    if self.detection_streak >= DETECTION_STREAK_REQUIRED:
                        self.confirming_started_ns = self.get_clock().now().nanoseconds
                        self._enter(AgentState.CONFIRMING)
                else:
                    self.detection_streak = 0
            else:
                self.detection_streak = max(0, self.detection_streak - 1)

        elif self.state == AgentState.CONFIRMING:
            try:
                assessment = self.perception.assess_target(
                    frame,
                    self.target_description,
                    bbox_hint=self.last_detection.bbox if self.last_detection else None,
                )
            except Exception as exc:
                self._log('error', f'VLM assess call failed: {exc}')
                return
            self._log('vlm_reason', json.dumps(asdict(assessment)))
            if assessment.found:
                self._record_target(assessment)
            else:
                self.detection_streak = 0
                self._enter(AgentState.SEARCHING)
                self._dispatch_waypoint()

    # ---- Mission manager service call -------------------------------------
    def _record_target(self, assessment: TargetAssessment) -> None:
        if self.briefing is None:
            return
        # Best-effort target geolocation: project bbox center onto ground plane
        # at the search altitude. For the trial sim this is approximate; a
        # follow-up can use camera intrinsics + gimbal pose for a true
        # ground-projection.
        target_lat, target_lon = self._estimate_target_latlon()
        result = self.tools.dispatch(
            'record_target_status',
            found=True,
            health=assessment.health,
            terrain=assessment.terrain,
            distance_to_safety_m=assessment.distance_to_safety_m,
            lat=target_lat,
            lon=target_lon,
            altitude_m=self.briefing.search_altitude_m,
            confidence=assessment.confidence,
            rationale=assessment.rationale,
        )
        self._log('tool_call', json.dumps({
            'tool': 'record_target_status',
            'lat': target_lat,
            'lon': target_lon,
            'ok': result.get('ok', False),
        }))

    def _estimate_target_latlon(self) -> tuple[float, float]:
        if self.local_xy is None or self.home_lat is None or self.home_lon is None:
            assert self.briefing is not None
            return self.briefing.search_center_lat, self.briefing.search_center_lon
        north_m, east_m = self.local_xy[0], self.local_xy[1]
        lat = self.home_lat + math.degrees(north_m / 6378137.0)
        lon = self.home_lon + math.degrees(
            east_m / (6378137.0 * math.cos(math.radians(self.home_lat)))
        )
        return lat, lon

    # ---- Conversions ------------------------------------------------------
    def _global_to_enu(self, lat: float, lon: float, alt_m: float):
        if self.home_lat is None or self.home_lon is None or self.home_alt is None:
            return None
        north = math.radians(lat - self.home_lat) * 6378137.0
        east = math.radians(lon - self.home_lon) * 6378137.0 * math.cos(math.radians(self.home_lat))
        up = alt_m
        return east, north, up

    # ---- Frontend publishers ---------------------------------------------
    def _publish_state(self) -> None:
        self.pub_state.publish(String(data=self.state.name))

    def _publish_plan(self) -> None:
        if self.briefing is None:
            return
        payload = {
            'mission_id': None,
            'center': [self.briefing.search_center_lat, self.briefing.search_center_lon],
            'radius_m': float(self.briefing.search_radius_m),
            'altitude_m': float(self.briefing.search_altitude_m),
            'waypoints': [[w.lat, w.lon] for w in self.waypoints],
        }
        self.pub_plan.publish(String(data=json.dumps(payload)))

    def _publish_overlay(self, det: Detection, img_w: int, img_h: int) -> None:
        payload = {
            'bbox': list(det.bbox),
            'img_w': img_w,
            'img_h': img_h,
            'label': det.label,
            'conf': det.confidence,
            'ts': time.time(),
        }
        self.pub_overlay.publish(String(data=json.dumps(payload)))

    def _log(self, kind: str, message_or_json: str) -> None:
        # If the payload looks like JSON, surface it under data; else under msg.
        try:
            data = json.loads(message_or_json)
        except (json.JSONDecodeError, TypeError):
            data = {'msg': message_or_json}
        entry = {
            'ts': time.time(),
            'kind': kind,
            'state': self.state.name,
            'data': data,
        }
        self.pub_log.publish(String(data=json.dumps(entry)))
        # Mirror to stdout for ros2 run convenience.
        self.get_logger().info(f'[{kind}] {message_or_json}')


def main(args=None):
    rclpy.init(args=args)
    node = SarAgentNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.perception.close()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
