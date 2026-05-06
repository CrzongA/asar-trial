# ASAR Navigation Guide

This document explains how to navigate the drone using the ROS 2 interface provided by the ASAR `mission_control` package.

## Topics Overview

The system provides two primary ways to control the drone's movement:
1. **Autonomous Waypoints**: Publishing to `/mission/goto`.
2. **Manual Teleoperation**: Publishing to `/teleop/manual_input`.

---

## 1. Autonomous Waypoints (/mission/goto)

The `/mission/goto` topic is used for high-level waypoint navigation. When you publish a position to this topic, the `mission_node` handles the state transitions (Arming, Takeoff, and Moving) automatically.

### Message Structure
- **Topic**: `/mission/goto`
- **Type**: `geometry_msgs/msg/PoseStamped`
- **Coordinate System**: **ENU** (East-North-Up)
    - `x`: East
    - `y`: North
    - `z`: Altitude (Up)

### Behavior
- **If IDLE**: The node will automatically request ARMING, switch PX4 to OFFBOARD mode, perform a TAKEOFF to the default altitude (2.0m), and then proceed to the requested waypoint.
- **If Flying**: The drone will immediately change its target and fly toward the new waypoint.
- **Holding**: Once the drone reaches the target (within a 0.4m tolerance), it will enter a HOLD state and hover.

### Command Line Example
To send the drone to a position 10 meters East, 5 meters North, at an altitude of 3 meters:

```bash
ros2 topic pub --once /mission/goto geometry_msgs/msg/PoseStamped "{
  header: {
    stamp: {sec: 0, nanosec: 0},
    frame_id: 'map'
  },
  pose: {
    position: {x: 10.0, y: 5.0, z: 3.0},
    orientation: {x: 0.0, y: 0.0, z: 0.0, w: 1.0}
  }
}"
```

---

## 2. Manual Teleoperation (/teleop/manual_input)

The `/teleop/manual_input` topic allows for direct control of the drone's attitude and throttle. This is intended for use by joysticks, the web dashboard, or manual CLI commands.

### Message Structure
- **Topic**: `/teleop/manual_input`
- **Type**: `px4_msgs/msg/ManualControlSetpoint`
- **Fields**:
    - `roll`: [-1.0, 1.0] (Right positive)
    - `pitch`: [-1.0, 1.0] (Forward positive)
    - `yaw`: [-1.0, 1.0] (Clockwise positive)
    - `throttle`: [-1.0, 1.0] (Up positive)

### Behavior
- **Override**: As soon as a message is received on this topic, the `mission_node` yields control. It switches the PX4 flight mode to **POSITION** (assisted manual) to ensure stability.
- **Heartbeat**: The `teleop_bridge` node republishes these inputs to PX4 at 50Hz to prevent failsafes.
- **Timeout**: If no manual input is received for **0.5 seconds**, the `mission_node` will automatically reclaim control, switch back to **OFFBOARD** mode, and hover at its current position.

### Command Line Example
To make the drone slowly climb while pitching forward slightly:

```bash
ros2 topic pub /teleop/manual_input px4_msgs/msg/ManualControlSetpoint "{
  roll: 0.0,
  pitch: 0.2,
  yaw: 0.0,
  throttle: 0.6
}"
```

---

## 3. Landing (/mission/land)

The `/mission/land` topic is used to trigger an automated landing sequence at the drone's current location.

### Message Structure
- **Topic**: `/mission/land`
- **Type**: `std_msgs/msg/Empty`

### Behavior
- **Transition**: Receiving any message on this topic will switch the `mission_node` to the `LAND` state.
- **PX4 Command**: The node sends a `VEHICLE_CMD_NAV_LAND` command to PX4.
- **Disarm**: Once PX4 detects that the drone has landed and disarms the motors, the `mission_node` returns to the `IDLE` state.

### Command Line Example
To trigger an immediate landing:

```bash
ros2 topic pub --once /mission/land std_msgs/msg/Empty {}
```

---

## Summary of State Transitions

| Action | Topic | State Result |
| :--- | :--- | :--- |
| Publish Waypoint | `/mission/goto` | `ARM` -> `TAKEOFF` -> `GOTO` -> `HOLD` |
| Publish Teleop | `/teleop/manual_input` | `TELEOP` (PX4 Position Mode) |
| Stop Teleop | (0.5s timeout) | `HOLD` (Reclaims Offboard) |
| Trigger Land | `/mission/land` | `LAND` -> `IDLE` |
