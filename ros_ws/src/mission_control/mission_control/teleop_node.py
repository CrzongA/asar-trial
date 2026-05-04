"""Teleop bridge: /teleop/manual_input -> /fmu/in/manual_control_input.

External clients (CLI, joystick, frontend) publish ManualControlSetpoint on the
friendly /teleop/manual_input topic. This node clamps + stamps each message and
republishes to PX4 at a fixed 50 Hz so PX4's RC-loss failsafe doesn't fire.

The autonomous mission_node watches /teleop/manual_input directly to know when
to yield offboard control to teleop -- this bridge only handles transport.
"""

from copy import deepcopy

import rclpy
from px4_msgs.msg import ManualControlSetpoint
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

PUBLISH_HZ = 50.0
INPUT_TIMEOUT_NS = 500_000_000  # stop republishing after 0.5 s of silence
DATA_SOURCE_MAVLINK_0 = 1


def _clamp_unit(v: float) -> float:
    if v != v:  # NaN
        return 0.0
    return max(-1.0, min(1.0, float(v)))


class TeleopBridge(Node):
    def __init__(self):
        super().__init__('teleop_bridge')

        self.create_subscription(
            ManualControlSetpoint, '/teleop/manual_input',
            self._on_input, PX4_QOS)
        self.pub = self.create_publisher(
            ManualControlSetpoint, '/fmu/in/manual_control_input', PX4_QOS)

        self.last_msg: ManualControlSetpoint | None = None
        self.last_msg_ns: int = 0
        self.create_timer(1.0 / PUBLISH_HZ, self._tick)

        self.get_logger().info(
            f'teleop bridge ready @ {PUBLISH_HZ:.0f} Hz. '
            'Publish px4_msgs/ManualControlSetpoint on /teleop/manual_input.')

    def _on_input(self, msg: ManualControlSetpoint) -> None:
        sanitized = deepcopy(msg)
        sanitized.roll = _clamp_unit(msg.roll)
        sanitized.pitch = _clamp_unit(msg.pitch)
        sanitized.yaw = _clamp_unit(msg.yaw)
        sanitized.throttle = _clamp_unit(msg.throttle)
        sanitized.valid = True
        sanitized.data_source = DATA_SOURCE_MAVLINK_0
        self.last_msg = sanitized
        self.last_msg_ns = self.get_clock().now().nanoseconds

    def _tick(self) -> None:
        if self.last_msg is None:
            return
        now_ns = self.get_clock().now().nanoseconds
        if now_ns - self.last_msg_ns > INPUT_TIMEOUT_NS:
            return
        # Stamp at every publish so PX4 sees fresh timestamps even on idle holds.
        out = self.last_msg
        out.timestamp = now_ns // 1000
        out.timestamp_sample = out.timestamp
        self.pub.publish(out)


def main(args=None):
    rclpy.init(args=args)
    node = TeleopBridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
