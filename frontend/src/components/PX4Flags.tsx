"use client";

import React, { useEffect, useState } from 'react';
import * as ROSLIB from 'roslib';
import { useRos } from './RosProvider';

// ---------- types ----------

type FailsafeFlags = {
  angular_velocity_invalid: boolean;
  attitude_invalid: boolean;
  local_altitude_invalid: boolean;
  local_position_invalid: boolean;
  local_velocity_invalid: boolean;
  global_position_invalid: boolean;
  manual_control_signal_lost: boolean;
  offboard_control_signal_lost: boolean;
  gcs_connection_lost: boolean;
  battery_warning: number;
  battery_unhealthy: boolean;
  battery_low_remaining_time: boolean;
  fd_critical_failure: boolean;
  fd_esc_arming_failure: boolean;
  fd_imbalanced_prop: boolean;
  fd_motor_failure: boolean;
  fd_alt_loss: boolean;
  geofence_breached: boolean;
  mission_failure: boolean;
  wind_limit_exceeded: boolean;
  flight_time_limit_exceeded: boolean;
  navigator_failure: boolean;
  home_position_invalid: boolean;
  auto_mission_missing: boolean;
};

const EMPTY_FLAGS: FailsafeFlags = {
  angular_velocity_invalid: false,
  attitude_invalid: false,
  local_altitude_invalid: false,
  local_position_invalid: false,
  local_velocity_invalid: false,
  global_position_invalid: false,
  manual_control_signal_lost: false,
  offboard_control_signal_lost: false,
  gcs_connection_lost: false,
  battery_warning: 0,
  battery_unhealthy: false,
  battery_low_remaining_time: false,
  fd_critical_failure: false,
  fd_esc_arming_failure: false,
  fd_imbalanced_prop: false,
  fd_motor_failure: false,
  fd_alt_loss: false,
  geofence_breached: false,
  mission_failure: false,
  wind_limit_exceeded: false,
  flight_time_limit_exceeded: false,
  navigator_failure: false,
  home_position_invalid: false,
  auto_mission_missing: false,
};

const ARM_DISARM_REASONS: Record<number, string> = {
  0: '—', 1: 'Stick gesture', 2: 'RC switch', 3: 'Cmd internal',
  4: 'Cmd external', 5: 'Mission start', 6: 'Landing',
  7: 'Preflight inaction', 8: 'Kill switch', 13: 'RC button', 14: 'FAILSAFE',
};

const NAV_STATE_NAMES: Record<number, string> = {
  0: 'MANUAL', 1: 'ALTCTL', 2: 'POSCTL', 3: 'AUTO_MISSION',
  4: 'AUTO_LOITER', 5: 'AUTO_RTL', 10: 'ACRO', 12: 'DESCEND',
  13: 'TERMINATION', 14: 'OFFBOARD', 15: 'STAB', 17: 'AUTO_TAKEOFF',
  18: 'AUTO_LAND', 19: 'FOLLOW', 20: 'PRECLAND', 21: 'ORBIT',
};

type StatusState = {
  armed: boolean;
  failsafe: boolean;
  failsafeUserTookOver: boolean;
  failsafeDeferState: number;
  preflightOk: boolean;
  navState: number;
  navStateUserIntention: number;
  latestArmReason: number;
  latestDisarmReason: number;
  safetyOff: boolean;
  rcCalibrationInProgress: boolean;
};

const EMPTY_STATUS: StatusState = {
  armed: false, failsafe: false, failsafeUserTookOver: false,
  failsafeDeferState: 0, preflightOk: false, navState: 0,
  navStateUserIntention: 0, latestArmReason: 0, latestDisarmReason: 0,
  safetyOff: false, rcCalibrationInProgress: false,
};

// ---------- main component ----------

export default function PX4Flags() {
  const { ros, connected } = useRos();
  const [flags, setFlags] = useState<FailsafeFlags>(EMPTY_FLAGS);
  const [status, setStatus] = useState<StatusState>(EMPTY_STATUS);
  const [lastUpdate, setLastUpdate] = useState<string>('—');

  useEffect(() => {
    if (!ros || !connected) return;

    const fsSub = new ROSLIB.Topic({
      ros,
      name: '/fmu/out/failsafe_flags',
      messageType: 'px4_msgs/msg/FailsafeFlags',
    });
    const stSub = new ROSLIB.Topic({
      ros,
      name: '/fmu/out/vehicle_status_v4',
      messageType: 'px4_msgs/msg/VehicleStatus',
    });

    fsSub.subscribe((msg: any) => {
      setFlags({
        angular_velocity_invalid: !!msg.angular_velocity_invalid,
        attitude_invalid: !!msg.attitude_invalid,
        local_altitude_invalid: !!msg.local_altitude_invalid,
        local_position_invalid: !!msg.local_position_invalid,
        local_velocity_invalid: !!msg.local_velocity_invalid,
        global_position_invalid: !!msg.global_position_invalid,
        manual_control_signal_lost: !!msg.manual_control_signal_lost,
        offboard_control_signal_lost: !!msg.offboard_control_signal_lost,
        gcs_connection_lost: !!msg.gcs_connection_lost,
        battery_warning: msg.battery_warning ?? 0,
        battery_unhealthy: !!msg.battery_unhealthy,
        battery_low_remaining_time: !!msg.battery_low_remaining_time,
        fd_critical_failure: !!msg.fd_critical_failure,
        fd_esc_arming_failure: !!msg.fd_esc_arming_failure,
        fd_imbalanced_prop: !!msg.fd_imbalanced_prop,
        fd_motor_failure: !!msg.fd_motor_failure,
        fd_alt_loss: !!msg.fd_alt_loss,
        geofence_breached: !!msg.geofence_breached,
        mission_failure: !!msg.mission_failure,
        wind_limit_exceeded: !!msg.wind_limit_exceeded,
        flight_time_limit_exceeded: !!msg.flight_time_limit_exceeded,
        navigator_failure: !!msg.navigator_failure,
        home_position_invalid: !!msg.home_position_invalid,
        auto_mission_missing: !!msg.auto_mission_missing,
      });
      setLastUpdate(new Date().toLocaleTimeString());
    });

    stSub.subscribe((msg: any) => {
      setStatus({
        armed: msg.arming_state === 2,
        failsafe: !!msg.failsafe,
        failsafeUserTookOver: !!msg.failsafe_and_user_took_over,
        failsafeDeferState: msg.failsafe_defer_state ?? 0,
        preflightOk: !!msg.pre_flight_checks_pass,
        navState: msg.nav_state ?? 0,
        navStateUserIntention: msg.nav_state_user_intention ?? 0,
        latestArmReason: msg.latest_arming_reason ?? 0,
        latestDisarmReason: msg.latest_disarming_reason ?? 0,
        safetyOff: !!msg.safety_off,
        rcCalibrationInProgress: !!msg.rc_calibration_in_progress,
      });
    });

    return () => { fsSub.unsubscribe(); stSub.unsubscribe(); };
  }, [ros, connected]);

  const modeOverridden = status.navState !== status.navStateUserIntention;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── top status chips (always visible) ── */}
      <div className="flex flex-row flex-nowrap gap-1 px-3 py-2 shrink-0 border-b border-neutral-800">
        <StatusChip label="ARMED"     active={status.armed}       activeClass="bg-amber-700/50 border-amber-500 text-amber-200"  inactiveClass="bg-neutral-900 border-neutral-700 text-neutral-500" />
        <StatusChip label="FAILSAFE"  active={status.failsafe}    activeClass="bg-red-700/60 border-red-500 text-red-200 animate-pulse" inactiveClass="bg-neutral-900 border-neutral-700 text-neutral-500" />
        <StatusChip label="PREFLIGHT" active={status.preflightOk} activeClass="bg-green-800/50 border-green-600 text-green-200"  inactiveClass="bg-red-900/40 border-red-700 text-red-300" />
        <StatusChip label="SAFETY"    active={status.safetyOff}   activeClass="bg-emerald-800/50 border-emerald-600 text-emerald-200" inactiveClass="bg-neutral-900 border-neutral-700 text-neutral-500" />
      </div>

      {/* ── scrollable section list ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 flex flex-col gap-1.5 text-xs font-mono">

        <Section title="Mode Tracking" defaultOpen>
          <Row label="Active mode"    value={NAV_STATE_NAMES[status.navState] ?? `STATE_${status.navState}`}          valueClass={modeOverridden ? 'text-red-400' : 'text-cyan-300'} />
          <Row label="User intention" value={NAV_STATE_NAMES[status.navStateUserIntention] ?? `STATE_${status.navStateUserIntention}`} />
          {modeOverridden && <Alert>Mode overridden by failsafe</Alert>}
          <Row label="Last arm"    value={ARM_DISARM_REASONS[status.latestArmReason]   ?? `#${status.latestArmReason}`} />
          <Row label="Last disarm" value={ARM_DISARM_REASONS[status.latestDisarmReason] ?? `#${status.latestDisarmReason}`}
               valueClass={status.latestDisarmReason === 14 ? 'text-red-400 font-bold' : undefined} />
          {status.failsafeDeferState === 2 && <Alert>Failsafe deferred (would trigger)</Alert>}
        </Section>

        <Section title="Control Links" defaultOpen>
          <FlagRow label="Manual ctrl signal lost"  bad={flags.manual_control_signal_lost} />
          <FlagRow label="Offboard ctrl signal lost" bad={flags.offboard_control_signal_lost} />
          <FlagRow label="GCS connection lost"       bad={flags.gcs_connection_lost} />
        </Section>

        <Section title="Estimation">
          <FlagRow label="Angular velocity invalid"   bad={flags.angular_velocity_invalid} />
          <FlagRow label="Attitude invalid"           bad={flags.attitude_invalid} />
          <FlagRow label="Local altitude invalid"     bad={flags.local_altitude_invalid} />
          <FlagRow label="Local position invalid"     bad={flags.local_position_invalid} />
          <FlagRow label="Local velocity invalid"     bad={flags.local_velocity_invalid} />
          <FlagRow label="Global position invalid"    bad={flags.global_position_invalid} />
          <FlagRow label="Home position invalid"      bad={flags.home_position_invalid} />
        </Section>

        <Section title="Failure Detector">
          <FlagRow label="Critical failure"    bad={flags.fd_critical_failure} />
          <FlagRow label="ESC arming failure"  bad={flags.fd_esc_arming_failure} />
          <FlagRow label="Imbalanced prop"     bad={flags.fd_imbalanced_prop} />
          <FlagRow label="Motor failure"       bad={flags.fd_motor_failure} />
          <FlagRow label="Altitude loss"       bad={flags.fd_alt_loss} />
        </Section>

        <Section title="Battery">
          <Row label="Warning level"
               value={['OK', 'LOW', 'CRITICAL', 'EMERGENCY'][flags.battery_warning] ?? `${flags.battery_warning}`}
               valueClass={flags.battery_warning === 0 ? 'text-green-400' : flags.battery_warning === 1 ? 'text-yellow-400' : 'text-red-400'} />
          <FlagRow label="Battery unhealthy"       bad={flags.battery_unhealthy} />
          <FlagRow label="Low remaining time"      bad={flags.battery_low_remaining_time} />
        </Section>

        <Section title="Other">
          <FlagRow label="Geofence breached"          bad={flags.geofence_breached} />
          <FlagRow label="Mission failure"            bad={flags.mission_failure} />
          <FlagRow label="Wind limit exceeded"        bad={flags.wind_limit_exceeded} />
          <FlagRow label="Flight time limit exceeded" bad={flags.flight_time_limit_exceeded} />
          <FlagRow label="Navigator failure"          bad={flags.navigator_failure} />
          <FlagRow label="Auto mission missing"       bad={flags.auto_mission_missing} />
          <FlagRow label="RC calibration active"      bad={status.rcCalibrationInProgress} />
        </Section>

        <div className="text-neutral-700 text-[10px] pt-0.5">Updated {lastUpdate}</div>
      </div>
    </div>
  );
}

// ---------- sub-components ----------

function StatusChip({ label, active, activeClass, inactiveClass }: {
  label: string; active: boolean; activeClass: string; inactiveClass: string;
}) {
  return (
    <div className={`flex-1 rounded border px-1 py-1 text-center text-[10px] font-bold whitespace-nowrap ${active ? activeClass : inactiveClass}`}>
      {label}
    </div>
  );
}

function Section({ title, children, defaultOpen = false }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-neutral-900 rounded-lg border border-neutral-800 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex flex-row items-center justify-between px-2 py-1.5 text-[10px] uppercase text-neutral-400 hover:text-neutral-200 bg-neutral-800/60 hover:bg-neutral-800 transition"
      >
        <span>{title}</span>
        <span className="text-neutral-600">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-2 py-1 flex flex-col gap-0.5">{children}</div>}
    </div>
  );
}

function FlagRow({ label, bad }: { label: string; bad: boolean }) {
  return (
    <div className={`flex flex-row items-center justify-between gap-2 py-0.5 ${bad ? 'text-red-400' : 'text-neutral-500'}`}>
      <span className="min-w-0 truncate">{label}</span>
      <span className={`shrink-0 text-[10px] font-bold px-1.5 rounded ${bad ? 'bg-red-900/50 text-red-300' : 'text-neutral-700'}`}>
        {bad ? 'FAIL' : 'ok'}
      </span>
    </div>
  );
}

function Row({ label, value, valueClass = 'text-neutral-300' }: {
  label: string; value: string; valueClass?: string;
}) {
  return (
    <div className="flex flex-row items-center justify-between gap-2 py-0.5 text-neutral-500">
      <span className="min-w-0 truncate">{label}</span>
      <span className={`shrink-0 ${valueClass}`}>{value}</span>
    </div>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-orange-400 flex flex-row items-center gap-1 py-0.5">
      <span>⚠</span><span>{children}</span>
    </div>
  );
}
