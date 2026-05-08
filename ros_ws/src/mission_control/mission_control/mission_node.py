"""ASAR mission_node: automated flight controller for PX4 SITL.

Topics:
  in   /mission/goto (geometry_msgs/PoseStamped, ENU)   high-level waypoint
  in   /mission/land (std_msgs/Empty)                    trigger landing
  in   /teleop/manual_input (px4_msgs/ManualControlSetpoint)  teleop probe
  in   /fmu/out/vehicle_local_position                   telemetry
  in   /fmu/out/vehicle_global_position                  global telemetry
  in   /fmu/out/vehicle_status                           arming/nav state
  in   /fmu/out/home_position                            home reference
  in   /fmu/out/failsafe_flags                           RC-loss tracking
  out  /fmu/in/offboard_control_mode                     setpoint type flag
  out  /fmu/in/trajectory_setpoint                       NED setpoint
  out  /fmu/in/vehicle_command                           arm / mode / land
Reorganized flow:
- Uses AUTO_TAKEOFF, AUTO_LOITER (with REPOSITION), and AUTO_LAND.
- No OFFBOARD mode setpoint streaming.
- Manual input on /teleop/manual_input pauses the mission by switching to POSCTL.
- Resumes mission when teleop goes silent.
"""

import math
import subprocess
from enum import Enum, auto

import rclpy
from geometry_msgs.msg import PoseStamped
from px4_msgs.msg import (
    FailsafeFlags,
    HomePosition,
    ManualControlSetpoint,
    VehicleCommand,
    VehicleCommandAck,
    VehicleLocalPosition,
    VehicleGlobalPosition,
    VehicleStatus,
    VehicleLandDetected,
)
from rclpy.node import Node
from rclpy.qos import (
    DurabilityPolicy,
    HistoryPolicy,
    QoSProfile,
    ReliabilityPolicy,
)
from std_msgs.msg import Empty, String, Int32


PX4_QOS = QoSProfile(
    reliability=ReliabilityPolicy.BEST_EFFORT,
    durability=DurabilityPolicy.VOLATILE,
    history=HistoryPolicy.KEEP_LAST,
    depth=5,
)

# PX4 Navigation States from vehicle_status.nav_state
NAV_STATE_POSCTL = 2
NAV_STATE_AUTO_LOITER = 4
NAV_STATE_AUTO_RTL = 5
NAV_STATE_OFFBOARD = 14
NAV_STATE_AUTO_TAKEOFF = 17
NAV_STATE_AUTO_LAND = 18

# PX4 Command constants
PX4_MAIN_MODE_POSCTL = 3.0
PX4_MAIN_MODE_AUTO = 4.0
PX4_SUB_MODE_AUTO_LOITER = 3.0

TELEOP_TIMEOUT_NS = 300_000_000  # 0.3 s of silence before resuming
TICK_HZ = 10.0
TAKEOFF_ALT_M = 20.0  # Default takeoff altitude


class State(Enum):
    IDLE = auto()
    TAKEOFF = auto()
    MISSION = auto()
    PAUSED = auto()
    LANDING = auto()


class MissionNode(Node):
    def __init__(self):
        super().__init__('mission_control_node')

        # PX4 telemetry
        self.create_subscription(VehicleLocalPosition, '/fmu/out/vehicle_local_position_v1', self._on_local_pos, PX4_QOS)
        self.create_subscription(VehicleGlobalPosition, '/fmu/out/vehicle_global_position', self._on_global_pos, PX4_QOS)
        self.create_subscription(VehicleStatus, '/fmu/out/vehicle_status_v4', self._on_status, PX4_QOS)
        self.create_subscription(HomePosition, '/fmu/out/home_position_v1', self._on_home_pos, PX4_QOS)
        self.create_subscription(VehicleLandDetected, '/fmu/out/vehicle_land_detected', self._on_land_detected, PX4_QOS)
        self.create_subscription(FailsafeFlags, '/fmu/out/failsafe_flags', self._on_failsafe_flags, PX4_QOS)
        self.create_subscription(VehicleCommandAck, '/fmu/out/vehicle_command_ack_v1', self._on_command_ack, PX4_QOS)

        # PX4 commands
        self.pub_command = self.create_publisher(VehicleCommand, '/fmu/in/vehicle_command', PX4_QOS)

        # High-level interface
        self.create_subscription(PoseStamped, '/mission/goto', self._on_goto, 10)
        self.create_subscription(Empty, '/mission/land', lambda _: self._enter(State.LANDING), 10)
        self.create_subscription(Empty, '/mission/cancel', self._on_cancel, 10)
        self.create_subscription(Empty, '/mission/reset', self._on_reset, 10)
        self.create_subscription(Empty, '/mission/rtl', self._on_rtl, 10)
        self.create_subscription(Empty, '/mission/completed', self._on_completed, 10)
        self.create_subscription(Int32, '/mission/current_waypoint', self._on_waypoint_index, 10)
        self.pub_status_text = self.create_publisher(String, '/mission/status_text', 10)

        # Teleop monitor
        self.create_subscription(ManualControlSetpoint, '/teleop/manual_input', self._on_teleop, PX4_QOS)

        # Node state
        self.state: State = State.IDLE
        self.previous_state: State = State.IDLE
        self.current_wp_index: int = -1
        self.mission_target_ned = (0.0, 0.0, -TAKEOFF_ALT_M)
        self.last_published_status: str = ""
        self.last_teleop_ns: int = 0
        
        # Telemetry cache
        self.last_local_pos: VehicleLocalPosition | None = None
        self.last_global_pos: VehicleGlobalPosition | None = None
        self.last_status: VehicleStatus | None = None
        self.last_home_pos: HomePosition | None = None
        self.last_land_detected: VehicleLandDetected | None = None
        
        # Internal control flags
        self.reposition_sent: bool = False
        self.command_retry_count: int = 0
        self.mode_settle_count: int = 0

        self.timer = self.create_timer(1.0 / TICK_HZ, self._tick)
        self.get_logger().info('Mission node initialized with Auto Loiter flow.')

    # ---- Callbacks --------------------------------------------------------
    def _on_local_pos(self, msg: VehicleLocalPosition) -> None: self.last_local_pos = msg
    def _on_global_pos(self, msg: VehicleGlobalPosition) -> None: self.last_global_pos = msg
    def _on_status(self, msg: VehicleStatus) -> None: self.last_status = msg
    def _on_home_pos(self, msg: HomePosition) -> None: self.last_home_pos = msg
    def _on_land_detected(self, msg: VehicleLandDetected) -> None: self.last_land_detected = msg
    def _on_failsafe_flags(self, msg: FailsafeFlags) -> None:
        if msg.manual_control_signal_lost and self.state == State.PAUSED:
            self.get_logger().warning('PX4 reports Manual Control Signal Lost!', throttle_duration_sec=5.0)

    def _on_command_ack(self, msg: VehicleCommandAck) -> None:
        if msg.result != VehicleCommandAck.VEHICLE_CMD_RESULT_ACCEPTED:
            self.get_logger().warning(f'PX4 rejected command {msg.command} (result: {msg.result}) in state {self.state.name}', throttle_duration_sec=2.0)

    def _on_goto(self, msg: PoseStamped) -> None:
        target_ned = self._enu_to_ned(msg.pose.position.x, msg.pose.position.y, msg.pose.position.z)
        self.mission_target_ned = target_ned
        self.reposition_sent = False
        
        self.get_logger().info(f'New mission target: {target_ned}')
        
        if self.state == State.IDLE or self.state == State.PAUSED:
            is_landed = self.last_land_detected.landed if self.last_land_detected else True
            if is_landed:
                self._enter(State.TAKEOFF)
            else:
                self.get_logger().info('Aircraft already flying, jumping to MISSION.')
                self._enter(State.MISSION)
        elif self.state == State.TAKEOFF:
            self.get_logger().info('Target updated during takeoff.')
        elif self.state == State.MISSION:
            self.get_logger().info('Retargeting active mission.')

    def _on_waypoint_index(self, msg: Int32) -> None:
        self.current_wp_index = msg.data
        if self.state == State.MISSION:
            self._publish_status(self.state)

    def _on_cancel(self, _msg: Empty | None) -> None:
        if self.state in (State.TAKEOFF, State.MISSION):
            self.get_logger().info('Mission cancelled. Braking at current position.')
            
            # Transition to IDLE state first
            self._enter(State.IDLE)
            
            # Reset loiter point to current position immediately to act as a brake
            if self.last_local_pos:
                self.mission_target_ned = (self.last_local_pos.x, self.last_local_pos.y, self.last_local_pos.z)
                self.reposition_sent = False # Allow _do_reposition to send
                self._do_reposition()
            
            # Re-send mode to ensure PX4 is in a stable loiter
            self._send_mode(PX4_MAIN_MODE_AUTO, PX4_SUB_MODE_AUTO_LOITER)

    def _on_completed(self, _msg: Empty) -> None:
        self.get_logger().info('Mission completed (received from frontend).')
        msg = String()
        msg.data = "Mission Completed"
        self.pub_status_text.publish(msg)

    def _on_teleop(self, _msg: ManualControlSetpoint) -> None:
        self.last_teleop_ns = self.get_clock().now().nanoseconds
        if self.state in (State.TAKEOFF, State.MISSION):
            self.get_logger().info('Manual input detected. Pausing mission.')
            self._enter(State.PAUSED)

    def _on_rtl(self, _msg: Empty) -> None:
        self.get_logger().info('RTL command received. Initiating Return to Launch.')
        self._send_command(VehicleCommand.VEHICLE_CMD_NAV_RETURN_TO_LAUNCH)
        self._enter(State.IDLE) # Let PX4 take over RTL

    def _on_reset(self, _msg: Empty) -> None:
        self.get_logger().info('Reset command received. Teleporting to spawn and rebooting PX4...')
        
        # 1. Force disarm
        self._send_command(VehicleCommand.VEHICLE_CMD_COMPONENT_ARM_DISARM, p1=0.0)
        
        # 2. Teleport in Gazebo
        # Pose: -5.26, 1.97, 3.65, 0, 0, 2.96 (yaw)
        # Quat: x: 0, y: 0, z: 0.9959, w: 0.0906
        gz_cmd = [
            'gz', 'service', '-s', '/world/asar_world/set_pose',
            '--reqtype', 'gz.msgs.Pose',
            '--reptype', 'gz.msgs.Boolean',
            '--timeout', '1000',
            '--req', 'name: "x500_gimbal_0", position: {x: -5.26, y: 1.97, z: 3.65}, orientation: {x: 0, y: 0, z: 0.9959, w: 0.0906}'
        ]
        try:
            # We use check=False because Gazebo might be busy or the service might time out
            # but we still want to proceed with the PX4 reboot.
            subprocess.run(gz_cmd, check=False, timeout=2.0)
        except Exception as e:
            self.get_logger().error(f'Failed to teleport in Gazebo: {e}')

        # 3. Reboot PX4 (VEHICLE_CMD_PREFLIGHT_REBOOT_SHUTDOWN = 246)
        # p1=1: reboot autopilot
        self._send_command(246, p1=1.0)
        
        # 4. Reset internal state
        self.state = State.IDLE
        self.mission_target_ned = (0.0, 0.0, -TAKEOFF_ALT_M)
        self.reposition_sent = False
        self.command_retry_count = 0

    # ---- State Machine ----------------------------------------------------
    def _enter(self, new_state: State) -> None:
        if new_state != self.state:
            self.get_logger().info(f'Transition: {self.state.name} -> {new_state.name} (PX4 nav_state: {self.last_status.nav_state if self.last_status else "unknown"})')
            self.previous_state = self.state
            self.state = new_state
            self.reposition_sent = False
            self.command_retry_count = 0
            self.mode_settle_count = 0

            if new_state == State.TAKEOFF:
                self.get_logger().info(f'Arming and initiating Auto Takeoff to {TAKEOFF_ALT_M}m...')
                self._send_command(VehicleCommand.VEHICLE_CMD_COMPONENT_ARM_DISARM, p1=1.0)
                # Use NaN for p5/p6 to signal "Takeoff at current location"
                self._send_command(VehicleCommand.VEHICLE_CMD_NAV_TAKEOFF, 
                                 p5=float('nan'), p6=float('nan'), p7=TAKEOFF_ALT_M)
            
            elif new_state == State.MISSION:
                self._send_mode(PX4_MAIN_MODE_AUTO, PX4_SUB_MODE_AUTO_LOITER)
            
            elif new_state == State.PAUSED:
                self._send_mode(PX4_MAIN_MODE_POSCTL)
            
            elif new_state == State.LANDING:
                self.get_logger().info('Initiating Auto Land...')
                self._send_command(VehicleCommand.VEHICLE_CMD_NAV_LAND)

            # Publish status for UI
            self._publish_status(new_state)

    def _publish_status(self, state: State) -> None:
        msg = String()
        if state == State.IDLE:
            # Only show "Mission Completed" if we just finished landing.
            # Otherwise, stay silent to avoid noise between waypoints.
            if self.previous_state == State.LANDING:
                msg.data = "Mission Completed"
            else:
                return
        elif state == State.TAKEOFF: msg.data = "Taking Off..."
        elif state == State.MISSION:
            if self.current_wp_index >= 1:
                msg.data = f"Proceeding to Waypoint {self.current_wp_index}"
            else:
                msg.data = "Mission Running"
        elif state == State.PAUSED: msg.data = "Mission Paused"
        elif state == State.LANDING: msg.data = "Landing..."
        
        if msg.data and msg.data != self.last_published_status:
            self.last_published_status = msg.data
            self.pub_status_text.publish(msg)

    def _tick(self) -> None:
        if self.last_status is None:
            return

        nav_state = self.last_status.nav_state
        
        if self.state == State.IDLE:
            return

        if self.state == State.TAKEOFF:
            is_landed = self.last_land_detected.landed if self.last_land_detected else True
            
            if not is_landed:
                # We are in the air. Wait for Loiter (takeoff completion) to transition.
                if nav_state == NAV_STATE_AUTO_LOITER:
                    self.get_logger().info('Takeoff complete (In-air & Loiter active). Transitioning to MISSION.')
                    self._enter(State.MISSION)
            else:
                # Still on the ground. We must ensure we are in AUTO_TAKEOFF mode.
                if nav_state != NAV_STATE_AUTO_TAKEOFF:
                    if self.command_retry_count % 10 == 0:
                        self.get_logger().warning(f'Still landed and not in TAKEOFF (nav_state: {nav_state}). Resending Arm & Takeoff...')
                        self._send_command(VehicleCommand.VEHICLE_CMD_COMPONENT_ARM_DISARM, p1=1.0)
                        self._send_command(VehicleCommand.VEHICLE_CMD_NAV_TAKEOFF, 
                                         p5=float('nan'), p6=float('nan'), p7=TAKEOFF_ALT_M)
                    self.command_retry_count += 1

        elif self.state == State.MISSION:
            # 1. Check if reached first to avoid redundant reposition commands
            if self._reached(self.mission_target_ned):
                self.get_logger().info('Mission target reached. Returning to IDLE.')
                self._enter(State.IDLE)
                return

            # 2. Handle navigation in Auto Loiter
            if nav_state != NAV_STATE_AUTO_LOITER:
                self.mode_settle_count = 0
                if self.command_retry_count % 10 == 0:
                    self._send_mode(PX4_MAIN_MODE_AUTO, PX4_SUB_MODE_AUTO_LOITER)
                self.command_retry_count += 1
            else:
                # We are in Auto Loiter. Wait for mode to settle before sending navigation.
                if not self.reposition_sent:
                    if self.mode_settle_count < 5:
                        self.mode_settle_count += 1
                    else:
                        self._do_reposition()
                self.command_retry_count += 1

        elif self.state == State.PAUSED:
            # Monitor teleop timeout
            now_ns = self.get_clock().now().nanoseconds
            if now_ns - self.last_teleop_ns > TELEOP_TIMEOUT_NS:
                self.get_logger().info('Teleop silent. Resuming mission.')
                self._enter(State.MISSION)

        elif self.state == State.LANDING:
            if self.last_status.arming_state == VehicleStatus.ARMING_STATE_DISARMED:
                self.get_logger().info('Landed and disarmed.')
                self._enter(State.IDLE)

    # ---- Helpers ----------------------------------------------------------
    def _do_reposition(self) -> None:
        lat, lon, alt = self._local_to_global(self.mission_target_ned)
        if lat is not None:
            self.get_logger().info(f'Sending REPOSITION to {lat:.6f}, {lon:.6f}, {alt:.2f}m (settle_count: {self.mode_settle_count})')
            self._send_command(VehicleCommand.VEHICLE_CMD_DO_REPOSITION, 
                             p1=1.0, p2=1.0, p4=float('nan'), 
                             p5=lat, p6=lon, p7=alt)
            self.reposition_sent = True

    def _local_to_global(self, target_ned):
        R = 6378137.0
        if self.last_home_pos:
            h_lat, h_lon, h_alt = self.last_home_pos.lat, self.last_home_pos.lon, self.last_home_pos.alt
        elif self.last_global_pos and self.last_local_pos:
            h_lat = self.last_global_pos.lat - math.degrees(self.last_local_pos.x / R)
            h_lon = self.last_global_pos.lon - math.degrees(self.last_local_pos.y / (R * math.cos(math.radians(self.last_global_pos.lat))))
            h_alt = self.last_global_pos.alt + self.last_local_pos.z
        else: return None, None, None
            
        t_lat = h_lat + math.degrees(target_ned[0] / R)
        t_lon = h_lon + math.degrees(target_ned[1] / (R * math.cos(math.radians(h_lat))))
        t_alt = h_alt - target_ned[2]
        return t_lat, t_lon, t_alt

    def _reached(self, target_ned, tol=2.0) -> bool:
        if self.last_local_pos is None: return False
        dx = self.last_local_pos.x - target_ned[0]
        dy = self.last_local_pos.y - target_ned[1]
        dz = self.last_local_pos.z - target_ned[2]
        return (dx*dx + dy*dy + dz*dz)**0.5 < tol

    def _enu_to_ned(self, x, y, z): return float(y), float(x), float(-z)

    def _send_command(self, command: int, **kwargs) -> None:
        msg = VehicleCommand()
        msg.timestamp = self.get_clock().now().nanoseconds // 1000
        msg.command = command
        for i in range(1, 8): setattr(msg, f'param{i}', kwargs.get(f'p{i}', 0.0))
        msg.target_system, msg.target_component = 1, 1
        msg.source_system, msg.source_component = 1, 1
        msg.from_external = True
        self.pub_command.publish(msg)

    def _send_mode(self, main_mode: float, sub_mode: float = 0.0) -> None:
        # MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 1
        self._send_command(VehicleCommand.VEHICLE_CMD_DO_SET_MODE, p1=1.0, p2=main_mode, p3=sub_mode)


def main(args=None):
    rclpy.init(args=args)
    node = MissionNode()
    try: rclpy.spin(node)
    except KeyboardInterrupt: pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()
