"""ASAR mission_node: offboard flight controller for PX4 SITL.

State machine (IDLE -> ARM -> TAKEOFF -> HOLD -> GOTO -> LAND -> IDLE) drives
the drone via PX4's offboard interface. Hands control over to teleop when
/teleop/manual_input becomes active, and takes it back when teleop goes silent.

Topics:
  in   /mission/goto (geometry_msgs/PoseStamped, ENU)   high-level waypoint
  in   /mission/land (std_msgs/Empty)                    trigger landing
  in   /teleop/manual_input (px4_msgs/ManualControlSetpoint)  teleop probe
  in   /fmu/out/vehicle_local_position                   telemetry
  in   /fmu/out/vehicle_status                           arming/nav state
  out  /fmu/in/offboard_control_mode                     setpoint type flag
  out  /fmu/in/trajectory_setpoint                       NED setpoint
  out  /fmu/in/vehicle_command                           arm / mode / land
"""

from enum import Enum, auto

import rclpy
from geometry_msgs.msg import PoseStamped
from px4_msgs.msg import (
    ManualControlSetpoint,
    OffboardControlMode,
    TrajectorySetpoint,
    VehicleCommand,
    VehicleLocalPosition,
    VehicleStatus,
)
from rclpy.node import Node
from rclpy.qos import (
    DurabilityPolicy,
    HistoryPolicy,
    QoSProfile,
    ReliabilityPolicy,
)
from std_msgs.msg import Empty


PX4_QOS = QoSProfile(
    reliability=ReliabilityPolicy.BEST_EFFORT,
    durability=DurabilityPolicy.VOLATILE,
    history=HistoryPolicy.KEEP_LAST,
    depth=5,
)

# PX4 main-mode constants for VEHICLE_CMD_DO_SET_MODE param2.
PX4_MAIN_MODE_MANUAL = 1.0
PX4_MAIN_MODE_POSITION = 3.0
PX4_MAIN_MODE_OFFBOARD = 6.0
PX4_BASE_MODE_CUSTOM = 1.0  # MAV_MODE_FLAG_CUSTOM_MODE_ENABLED

TELEOP_TIMEOUT_NS = 500_000_000  # 0.5 s of silence before reclaiming OFFBOARD
SETPOINT_HZ = 20.0
TAKEOFF_ALT_M = 2.0  # ENU z


class State(Enum):
    IDLE = auto()
    ARM = auto()
    TAKEOFF = auto()
    HOLD = auto()
    GOTO = auto()
    LAND = auto()
    TELEOP = auto()


def enu_to_ned(x_e, y_n, z_up):
    """ROS ENU (east, north, up) -> PX4 NED (north, east, down)."""
    return float(y_n), float(x_e), float(-z_up)


class MissionNode(Node):
    def __init__(self):
        super().__init__('mission_control_node')

        # PX4 telemetry
        self.create_subscription(
            VehicleLocalPosition, '/fmu/out/vehicle_local_position_v1',
            self._on_local_pos, PX4_QOS)
        self.create_subscription(
            VehicleStatus, '/fmu/out/vehicle_status_v4',
            self._on_status, PX4_QOS)

        # PX4 commands. NOTE: /fmu/in/* topics are unversioned on this PX4 build
        # (v1.17 alpha) — the agent only creates a _v<N> suffix when the firmware's
        # message hash diverges from px4_msgs' default. Publishing to a _v1 topic
        # PX4 isn't subscribed to silently no-ops (subscriber count = 0).
        self.pub_offboard = self.create_publisher(
            OffboardControlMode, '/fmu/in/offboard_control_mode', PX4_QOS)
        self.pub_setpoint = self.create_publisher(
            TrajectorySetpoint, '/fmu/in/trajectory_setpoint', PX4_QOS)
        self.pub_command = self.create_publisher(
            VehicleCommand, '/fmu/in/vehicle_command', PX4_QOS)

        # High-level interface
        self.create_subscription(
            PoseStamped, '/mission/goto', self._on_goto, 10)
        self.create_subscription(
            Empty, '/mission/land', lambda _msg: self._enter(State.LAND), 10)

        # Teleop probe: any message arriving here flips us into TELEOP.
        self.create_subscription(
            ManualControlSetpoint, '/teleop/manual_input',
            self._on_teleop, PX4_QOS)

        self.state: State = State.IDLE
        self.target_ned = (0.0, 0.0, -TAKEOFF_ALT_M)
        self.last_local_pos: VehicleLocalPosition | None = None
        self.last_status: VehicleStatus | None = None
        self.last_teleop_ns: int = 0
        self.setpoint_count: int = 0  # PX4 needs ≥10 setpoints before accepting OFFBOARD

        self.timer = self.create_timer(1.0 / SETPOINT_HZ, self._tick)
        self.get_logger().info(
            'mission_node ready. Publish PoseStamped on /mission/goto to start a mission.')

    # ---- subscriptions ----------------------------------------------------
    def _on_local_pos(self, msg: VehicleLocalPosition) -> None:
        if self.last_local_pos is None:
            self.get_logger().info('First VehicleLocalPosition received.')
        self.last_local_pos = msg

    def _on_status(self, msg: VehicleStatus) -> None:
        if self.last_status is None:
            self.get_logger().info('First VehicleStatus received.')
        self.last_status = msg

    def _on_goto(self, msg: PoseStamped) -> None:
        self.target_ned = enu_to_ned(
            msg.pose.position.x, msg.pose.position.y, msg.pose.position.z)
        self.get_logger().info(
            f'goto NED={self.target_ned} (from ENU '
            f'x={msg.pose.position.x:.2f} y={msg.pose.position.y:.2f} z={msg.pose.position.z:.2f})')
        if self.state == State.IDLE:
            self._enter(State.ARM)
        else:
            self._enter(State.GOTO)

    def _on_teleop(self, _msg: ManualControlSetpoint) -> None:
        self.last_teleop_ns = self.get_clock().now().nanoseconds
        if self.state != State.TELEOP:
            self.get_logger().info('teleop active -> switching PX4 to POSITION')
            self._send_mode(PX4_MAIN_MODE_POSITION)
            self._enter(State.TELEOP)

    # ---- state machine ----------------------------------------------------
    def _enter(self, new_state: State) -> None:
        if new_state != self.state:
            self.get_logger().info(f'state: {self.state.name} -> {new_state.name}')
            self.state = new_state
            self.setpoint_count = 0

    def _tick(self) -> None:
        # Always stream the offboard heartbeat + a setpoint while we expect to fly.
        # PX4 will fall out of OFFBOARD if this stops for >0.5 s.
        if self.state in (State.ARM, State.TAKEOFF, State.HOLD, State.GOTO, State.LAND):
            self._publish_offboard_mode()
            self._publish_setpoint(self.target_ned)
            self.setpoint_count += 1

        if self.state == State.ARM:
            # Stream setpoints first so PX4 will accept OFFBOARD
            if self.setpoint_count < 10:
                return

            # Check if we are already in the target state
            is_armed = self.last_status and self.last_status.arming_state == VehicleStatus.ARMING_STATE_ARMED
            is_offboard = self.last_status and self.last_status.nav_state == VehicleStatus.NAVIGATION_STATE_OFFBOARD

            if is_armed and is_offboard:
                self._enter(State.TAKEOFF)
            else:
                # Retry every 10 ticks (0.5s)
                if self.setpoint_count % 10 == 0:
                    if not is_offboard:
                        self.get_logger().info('Requesting OFFBOARD mode...')
                        self._send_mode(PX4_MAIN_MODE_OFFBOARD)
                    if not is_armed:
                        if self.last_status and not self.last_status.pre_flight_checks_pass:
                            self.get_logger().warning('Pre-flight checks failing! PX4 may refuse to arm.', throttle_duration_sec=2.0)
                        self.get_logger().info('Requesting ARM...')
                        self._send_arm(True)

        elif self.state == State.TAKEOFF:
            if self._reached(self.target_ned, tol=0.4):
                self._enter(State.HOLD)
            elif self.setpoint_count % 20 == 0:
                # Periodically re-verify we are still in offboard/armed
                if self.last_status and (self.last_status.arming_state != VehicleStatus.ARMING_STATE_ARMED or 
                                       self.last_status.nav_state != VehicleStatus.NAVIGATION_STATE_OFFBOARD):
                    self.get_logger().warning('Lost OFFBOARD or ARMED state during takeoff! Reverting to ARM.')
                    self._enter(State.ARM)

        elif self.state == State.HOLD:
            pass  # hover at target_ned until the next /mission/goto or /mission/land

        elif self.state == State.GOTO:
            if self._reached(self.target_ned, tol=0.4):
                self._enter(State.HOLD)

        elif self.state == State.LAND:
            self._send_command(VehicleCommand.VEHICLE_CMD_NAV_LAND)
            if self.last_status and self.last_status.arming_state == VehicleStatus.ARMING_STATE_DISARMED:
                self._enter(State.IDLE)

        elif self.state == State.TELEOP:
            now_ns = self.get_clock().now().nanoseconds
            if now_ns - self.last_teleop_ns > TELEOP_TIMEOUT_NS:
                self.get_logger().info('teleop idle -> reclaiming OFFBOARD')
                self._send_mode(PX4_MAIN_MODE_OFFBOARD)
                # Snap target to current pose so we don't lurch on resume.
                if self.last_local_pos is not None:
                    self.target_ned = (
                        self.last_local_pos.x, self.last_local_pos.y, self.last_local_pos.z)
                self._enter(State.HOLD)

    # ---- helpers ----------------------------------------------------------
    def _reached(self, target_ned, tol=0.4) -> bool:
        p = self.last_local_pos
        if p is None:
            return False
        dx, dy, dz = p.x - target_ned[0], p.y - target_ned[1], p.z - target_ned[2]
        return (dx * dx + dy * dy + dz * dz) ** 0.5 < tol

    def _now_us(self) -> int:
        return self.get_clock().now().nanoseconds // 1000

    def _publish_offboard_mode(self) -> None:
        msg = OffboardControlMode()
        msg.timestamp = self._now_us()
        msg.position = True
        msg.velocity = False
        msg.acceleration = False
        msg.attitude = False
        msg.body_rate = False
        self.pub_offboard.publish(msg)

    def _publish_setpoint(self, ned) -> None:
        msg = TrajectorySetpoint()
        msg.timestamp = self._now_us()
        msg.position = [ned[0], ned[1], ned[2]]
        msg.yaw = 0.0
        self.pub_setpoint.publish(msg)

    def _send_command(self, command: int, p1: float = 0.0, p2: float = 0.0) -> None:
        msg = VehicleCommand()
        msg.timestamp = self._now_us()
        msg.command = command
        msg.param1 = p1
        msg.param2 = p2
        msg.target_system = 1
        msg.target_component = 1
        msg.source_system = 1
        msg.source_component = 1
        msg.from_external = True
        self.pub_command.publish(msg)

    def _send_arm(self, arm: bool) -> None:
        self._send_command(
            VehicleCommand.VEHICLE_CMD_COMPONENT_ARM_DISARM, 1.0 if arm else 0.0)

    def _send_mode(self, main_mode: float) -> None:
        self._send_command(
            VehicleCommand.VEHICLE_CMD_DO_SET_MODE, PX4_BASE_MODE_CUSTOM, main_mode)


def main(args=None):
    rclpy.init(args=args)
    node = MissionNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
