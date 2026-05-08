"""Teleop bridge: /teleop/manual_input -> /fmu/in/manual_control_input.

External clients (CLI, joystick, frontend) publish ManualControlSetpoint on the
friendly /teleop/manual_input topic. This node clamps + stamps each message and
republishes to PX4 at a fixed 50 Hz so PX4's RC-loss failsafe doesn't fire.

The autonomous mission_node watches /teleop/manual_input directly to know when
to yield offboard control to teleop -- this bridge only handles transport.

Gimbal: frontend publishes GimbalManagerSetManualControl on /teleop/gimbal_input.
This node integrates the joystick rates into absolute angles and publishes
px4_msgs/VehicleCommand (VEHICLE_CMD_DO_GIMBAL_MANAGER_PITCHYAW) to
/fmu/in/vehicle_command. PX4's gimbal manager then drives the simulated
gimbal joints in Gazebo.
"""

from copy import deepcopy
import math

import rclpy
from px4_msgs.msg import ManualControlSetpoint, GimbalManagerSetManualControl
from std_msgs.msg import Float64
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
INPUT_TIMEOUT_NS = 2_000_000_000  # stop republishing after 2.0 s of silence
# px4_msgs/ManualControlSetpoint enum: SOURCE_RC=1, SOURCE_MAVLINK_0=2.
# With COM_RC_IN_MODE=1 (joystick only) PX4 invalidates any setpoint whose
# data_source==SOURCE_RC, so we must claim MAVLink_0 or PX4 silently drops it.
DATA_SOURCE_MAVLINK_0 = ManualControlSetpoint.SOURCE_MAVLINK_0

# Gimbal: degrees per second at full stick deflection (matches MNT_RATE_PITCH/YAW default of 30)
GIMBAL_RATE_DEG_S = 30.0
# Pitch limits matching MNT_MIN_PITCH=-135, MNT_MAX_PITCH=45 from airframe config
GIMBAL_PITCH_MIN_DEG = -135.0
GIMBAL_PITCH_MAX_DEG = 45.0
# Yaw: MNT_RANGE_YAW=720, symmetric about 0
GIMBAL_YAW_RANGE_DEG = 360.0


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
        # Gimbal joints are controlled directly via ros_gz_bridge (see launch_sim.sh).
        # launch_sim.sh bridges /gimbal/pitch and /gimbal/yaw (std_msgs/Float64, radians)
        # to the Gazebo joint command topics for x500_gimbal_0.
        self.gz_pitch_pub = self.create_publisher(Float64, '/gimbal/pitch', 10)
        self.gz_yaw_pub = self.create_publisher(Float64, '/gimbal/yaw', 10)
        self.gimbal_pub = self.create_publisher(
            GimbalManagerSetManualControl, '/fmu/in/gimbal_manager_set_manual_control', PX4_QOS)

        self.last_msg: ManualControlSetpoint | None = None
        self.last_msg_ns: int = 0
        self.last_gimbal_msg: GimbalManagerSetManualControl | None = None
        self.last_gimbal_ns: int = 0

        # Accumulated gimbal position in degrees (rate-integrated from joystick).
        self._gimbal_pitch_deg: float = 0.0
        self._gimbal_yaw_deg: float = 0.0
        self._gimbal_configured: bool = False

        self.create_timer(1.0 / PUBLISH_HZ, self._tick)

        self.get_logger().info(
            f'teleop bridge ready @ {PUBLISH_HZ:.0f} Hz. '
            'Flight: /teleop/manual_input | Gimbal: /teleop/gimbal_input -> {PX4, /gimbal/{pitch,yaw}}')

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
        dt = 1.0 / PUBLISH_HZ

        # 1. Handle flight controls
        if self.last_msg is not None and (now_ns - self.last_msg_ns < INPUT_TIMEOUT_NS):
            out = self.last_msg
            out.timestamp = now_ns // 1000
            out.timestamp_sample = out.timestamp
            self.pub.publish(out)

        # 2. Handle gimbal
        if self.last_gimbal_msg is not None and (now_ns - self.last_gimbal_ns < INPUT_TIMEOUT_NS):
            # 2a. Send to PX4 Gimbal Manager.
            # This allows PX4 to track gimbal state and potentially manage
            # multi-client contention or state-based overrides.
            px4_gimbal = deepcopy(self.last_gimbal_msg)
            px4_gimbal.timestamp = now_ns // 1000
            self.gimbal_pub.publish(px4_gimbal)

            # 2b. Integrate joystick rates → absolute angles → publish
            # directly to Gazebo joint command topics via the ros_gz_bridge in launch_sim.sh.
            # NOTE: We maintain this direct path because the simulated gimbal 
            # often lacks the necessary internal PX4-to-Gazebo bridge for manager-driven control.
            pitch_rate = _clamp_unit(self.last_gimbal_msg.pitch_rate)
            yaw_rate = _clamp_unit(self.last_gimbal_msg.yaw_rate)

            self._gimbal_pitch_deg += pitch_rate * GIMBAL_RATE_DEG_S * dt
            self._gimbal_yaw_deg += yaw_rate * GIMBAL_RATE_DEG_S * dt

            self._gimbal_pitch_deg = max(GIMBAL_PITCH_MIN_DEG,
                                         min(GIMBAL_PITCH_MAX_DEG, self._gimbal_pitch_deg))
            self._gimbal_yaw_deg = max(-GIMBAL_YAW_RANGE_DEG / 2,
                                       min(GIMBAL_YAW_RANGE_DEG / 2, self._gimbal_yaw_deg))

            pitch_msg = Float64()
            pitch_msg.data = math.radians(self._gimbal_pitch_deg)
            self.gz_pitch_pub.publish(pitch_msg)

            yaw_msg = Float64()
            yaw_msg.data = math.radians(self._gimbal_yaw_deg)
            self.gz_yaw_pub.publish(yaw_msg)


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
