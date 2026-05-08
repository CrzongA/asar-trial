"""mission_manager: receives target status reports and drives Secure-Target hover.

Service:
  /mission/record_target_status (asar_msgs/srv/RecordTargetStatus)
    Called by sar_agent (or any other source) when a target is identified.

Latched topic:
  /mission/target_status (asar_msgs/msg/TargetStatus)
    Republishes the most recent recorded report for late subscribers.

When found=true, publishes a PoseStamped to /mission/goto at the target's
location so mission_node enters Auto Loiter / REPOSITION above the target.
"""

import json
import math
import os
import time
import uuid
from pathlib import Path

import rclpy
from asar_msgs.msg import TargetStatus
from asar_msgs.srv import RecordTargetStatus
from geometry_msgs.msg import PoseStamped
from px4_msgs.msg import HomePosition, VehicleGlobalPosition, VehicleLocalPosition
from rclpy.node import Node
from rclpy.qos import (
    DurabilityPolicy,
    HistoryPolicy,
    QoSProfile,
    ReliabilityPolicy,
)


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

EARTH_R_M = 6378137.0


class MissionManagerNode(Node):
    def __init__(self):
        super().__init__('mission_manager_node')

        self.mission_id = str(uuid.uuid4())[:8]
        self.history: list[dict] = []
        self.record_path = Path(os.environ.get('ASAR_MISSION_LOG', '/tmp/asar_missions.jsonl'))

        self.create_subscription(HomePosition, '/fmu/out/home_position_v1', self._on_home, PX4_QOS)
        self.create_subscription(VehicleGlobalPosition, '/fmu/out/vehicle_global_position', self._on_global, PX4_QOS)
        self.create_subscription(VehicleLocalPosition, '/fmu/out/vehicle_local_position_v1', self._on_local, PX4_QOS)

        self.last_home: HomePosition | None = None
        self.last_global: VehicleGlobalPosition | None = None
        self.last_local: VehicleLocalPosition | None = None

        self.pub_status = self.create_publisher(TargetStatus, '/mission/target_status', LATCHED_QOS)
        self.pub_goto = self.create_publisher(PoseStamped, '/mission/goto', 10)

        self.srv = self.create_service(
            RecordTargetStatus,
            '/mission/record_target_status',
            self._on_record,
        )

        self.get_logger().info(
            f'mission_manager started (mission_id={self.mission_id}); log -> {self.record_path}'
        )

    def _on_home(self, msg: HomePosition) -> None:
        self.last_home = msg

    def _on_global(self, msg: VehicleGlobalPosition) -> None:
        self.last_global = msg

    def _on_local(self, msg: VehicleLocalPosition) -> None:
        self.last_local = msg

    def _on_record(self, request: RecordTargetStatus.Request, response: RecordTargetStatus.Response):
        record = {
            'ts': time.time(),
            'mission_id': self.mission_id,
            'found': bool(request.found),
            'health': request.health,
            'terrain': request.terrain,
            'distance_to_safety_m': float(request.distance_to_safety_m),
            'latitude': float(request.latitude),
            'longitude': float(request.longitude),
            'altitude_m': float(request.altitude_m),
            'confidence': float(request.confidence),
            'vlm_rationale': request.vlm_rationale,
        }
        self.history.append(record)
        self._persist(record)

        status = TargetStatus()
        status.found = record['found']
        status.mission_id = self.mission_id
        status.health = record['health']
        status.terrain = record['terrain']
        status.distance_to_safety_m = record['distance_to_safety_m']
        status.latitude = record['latitude']
        status.longitude = record['longitude']
        status.altitude_m = record['altitude_m']
        status.confidence = record['confidence']
        status.vlm_rationale = record['vlm_rationale']
        now = self.get_clock().now().to_msg()
        status.stamp = now
        self.pub_status.publish(status)

        if request.found:
            self._secure_target(request.latitude, request.longitude, request.altitude_m)

        response.accepted = True
        response.mission_id = self.mission_id
        return response

    def _secure_target(self, lat: float, lon: float, alt_m: float) -> None:
        enu = self._global_to_enu(lat, lon, alt_m)
        if enu is None:
            self.get_logger().warning(
                'No home/global fix yet; cannot publish secure-target goto. Will retry on next call.'
            )
            return
        east, north, up = enu
        msg = PoseStamped()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = 'map'
        msg.pose.position.x = east
        msg.pose.position.y = north
        msg.pose.position.z = up
        msg.pose.orientation.w = 1.0
        self.pub_goto.publish(msg)
        self.get_logger().info(
            f'Secure-Target goto published: ENU=({east:.2f}, {north:.2f}, {up:.2f}) '
            f'<- ({lat:.6f}, {lon:.6f}, {alt_m:.2f}m)'
        )

    def _global_to_enu(self, lat: float, lon: float, alt_m: float):
        if self.last_home is not None:
            h_lat, h_lon, h_alt = self.last_home.lat, self.last_home.lon, self.last_home.alt
        elif self.last_global is not None and self.last_local is not None:
            h_lat = self.last_global.lat - math.degrees(self.last_local.x / EARTH_R_M)
            h_lon = self.last_global.lon - math.degrees(
                self.last_local.y / (EARTH_R_M * math.cos(math.radians(self.last_global.lat)))
            )
            h_alt = self.last_global.alt + self.last_local.z
        else:
            return None

        north = math.radians(lat - h_lat) * EARTH_R_M
        east = math.radians(lon - h_lon) * EARTH_R_M * math.cos(math.radians(h_lat))
        up = alt_m - h_alt
        return east, north, up

    def _persist(self, record: dict) -> None:
        try:
            with self.record_path.open('a') as fh:
                fh.write(json.dumps(record) + '\n')
        except OSError as exc:
            self.get_logger().warning(f'Failed to persist mission record: {exc}')


def main(args=None):
    rclpy.init(args=args)
    node = MissionManagerNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
