"""Teleop bridge: /teleop/manual_input -> /fmu/in/manual_control_input.

External clients (CLI, joystick, frontend) publish ManualControlSetpoint on the
friendly /teleop/manual_input topic. This node clamps + stamps each message and
republishes to PX4 at a fixed 50 Hz so PX4's RC-loss failsafe doesn't fire.

The autonomous mission_node watches /teleop/manual_input directly to know when
to yield offboard control to teleop -- this bridge only handles transport.
"""

from copy import deepcopy

import rclpy
from px4_msgs.msg import ManualControlSetpoint, GimbalManagerSetManualControl
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
# px4_msgs/ManualControlSetpoint enum: SOURCE_RC=1, SOURCE_MAVLINK_0=2.
# With COM_RC_IN_MODE=1 (joystick only) PX4 invalidates any setpoint whose
# data_source==SOURCE_RC, so we must claim MAVLink_0 or PX4 silently drops it.
DATA_SOURCE_MAVLINK_0 = ManualControlSetpoint.SOURCE_MAVLINK_0


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
        self.create_subscription(
            GimbalManagerSetManualControl, '/teleop/gimbal_input',
            self._on_gimbal_input, PX4_QOS)
        # PX4 listens on the unversioned topics on this build.
        self.pub = self.create_publisher(
            ManualControlSetpoint, '/fmu/in/manual_control_input', PX4_QOS)
        self.gimbal_pub = self.create_publisher(
            GimbalManagerSetManualControl, '/fmu/in/gimbal_manager_set_manual_control', PX4_QOS)

        self.last_msg: ManualControlSetpoint | None = None
        self.last_msg_ns: int = 0
        self.last_gimbal_msg: GimbalManagerSetManualControl | None = None
        self.last_gimbal_ns: int = 0
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

    def _on_gimbal_input(self, msg: GimbalManagerSetManualControl) -> None:
        self.last_gimbal_msg = msg
        self.last_gimbal_ns = self.get_clock().now().nanoseconds

    def _tick(self) -> None:
        now_ns = self.get_clock().now().nanoseconds
        
        # 1. Handle flight controls
        if self.last_msg is not None and (now_ns - self.last_msg_ns < INPUT_TIMEOUT_NS):
            out = self.last_msg
            out.timestamp = now_ns // 1000
            out.timestamp_sample = out.timestamp
            self.pub.publish(out)
        # 2. Handle gimbal controls.
        # PX4's gimbal manager starts with sysid_primary_control=0 ("no one in control").
        # The check is origin_sysid == sysid_primary_control, so sending with origin_sysid=0
        # matches the default and is accepted without needing a CONFIGURE command.
        # MNT_MODE_OUT=1 (AUX) routes through OutputRC which publishes gimbal_controls,
        # the topic GZGimbal::pollSetpoint() reads to drive Gazebo joint commands.
        if self.last_gimbal_msg is not None and (now_ns - self.last_gimbal_ns < INPUT_TIMEOUT_NS):
            g = deepcopy(self.last_gimbal_msg)
            g.timestamp = now_ns // 1000
            g.pitch = float('nan')  # NaN: use rate control, not position
            g.yaw = float('nan')
            g.pitch_rate = _clamp_unit(g.pitch_rate)
            g.yaw_rate = _clamp_unit(g.yaw_rate)
            g.origin_sysid = 0   # matches default sysid_primary_control=0
            g.origin_compid = 0  # matches default compid_primary_control=0
            g.target_system = 1
            g.target_component = 1
            g.gimbal_device_id = 0
            g.flags = 0
            self.gimbal_pub.publish(g)


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
