"use client";

import React, { useEffect, useState } from 'react';
import { useRos } from './RosProvider';
import * as ROSLIB from 'roslib';

const NAV_STATES: Record<number, string> = {
  0: 'MANUAL',
  1: 'ALTCTL',
  2: 'POSCTL',
  3: 'AUTO_MISSION',
  4: 'AUTO_LOITER',
  5: 'AUTO_RTL',
  10: 'ACRO',
  14: 'OFFBOARD',
  15: 'STAB',
  17: 'AUTO_TAKEOFF',
  18: 'AUTO_LAND',
  19: 'AUTO_FOLLOW',
  20: 'AUTO_PRECLAND',
};

const BATTERY_WARNING: Record<number, { label: string; color: string }> = {
  0: { label: 'OK', color: 'text-green-400' },
  1: { label: 'LOW', color: 'text-yellow-400' },
  2: { label: 'CRITICAL', color: 'text-orange-400' },
  3: { label: 'EMERGENCY', color: 'text-red-500' },
};

function quatToEuler(q: number[]): { roll: number; pitch: number; yaw: number } {
  const [w, x, y, z] = q;
  const sinr_cosp = 2 * (w * x + y * z);
  const cosr_cosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr_cosp, cosr_cosp);
  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);
  const siny_cosp = 2 * (w * z + x * y);
  const cosy_cosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny_cosp, cosy_cosp);
  return { roll, pitch, yaw };
}

const rad2deg = (r: number) => (r * 180) / Math.PI;

type Telemetry = {
  alt: number;
  speed: number;
  battery: number | null;
  voltage: number | null;
  batteryWarning: number;
  mode: string;
  armed: boolean;
  preflightOk: boolean;
  roll: number;
  pitch: number;
  yaw: number;
  lat: number | null;
  lon: number | null;
};

export default function TelemetryDashboard() {
  const { ros, connected } = useRos();
  const [t, setT] = useState<Telemetry>({
    alt: 0,
    speed: 0,
    battery: null,
    voltage: null,
    batteryWarning: 0,
    mode: '—',
    armed: false,
    preflightOk: false,
    roll: 0,
    pitch: 0,
    yaw: 0,
    lat: null,
    lon: null,
  });

  useEffect(() => {
    if (!ros || !connected) return;

    const posSub = new ROSLIB.Topic({
      ros,
      name: '/fmu/out/vehicle_local_position_v1',
      messageType: 'px4_msgs/msg/VehicleLocalPosition',
    });
    const statusSub = new ROSLIB.Topic({
      ros,
      name: '/fmu/out/vehicle_status_v4',
      messageType: 'px4_msgs/msg/VehicleStatus',
    });
    const batSub = new ROSLIB.Topic({
      ros,
      name: '/fmu/out/battery_status',
      messageType: 'px4_msgs/msg/BatteryStatus',
    });
    const attSub = new ROSLIB.Topic({
      ros,
      name: '/fmu/out/vehicle_attitude',
      messageType: 'px4_msgs/msg/VehicleAttitude',
    });
    const gpsSub = new ROSLIB.Topic({
      ros,
      name: '/fmu/out/vehicle_global_position',
      messageType: 'px4_msgs/msg/VehicleGlobalPosition',
    });

    posSub.subscribe((msg: any) => {
      setT(prev => ({
        ...prev,
        alt: -msg.z,
        speed: Math.sqrt(msg.vx * msg.vx + msg.vy * msg.vy + msg.vz * msg.vz),
      }));
    });

    statusSub.subscribe((msg: any) => {
      setT(prev => ({
        ...prev,
        mode: NAV_STATES[msg.nav_state] ?? `STATE_${msg.nav_state}`,
        armed: msg.arming_state === 2,
        preflightOk: !!msg.pre_flight_checks_pass,
      }));
    });

    batSub.subscribe((msg: any) => {
      setT(prev => ({
        ...prev,
        battery: Number.isFinite(msg.remaining) ? msg.remaining * 100 : prev.battery,
        voltage: Number.isFinite(msg.voltage_v) ? msg.voltage_v : prev.voltage,
        batteryWarning: msg.warning ?? 0,
      }));
    });

    attSub.subscribe((msg: any) => {
      if (!msg.q || msg.q.length !== 4) return;
      const e = quatToEuler(msg.q);
      setT(prev => ({ ...prev, roll: e.roll, pitch: e.pitch, yaw: e.yaw }));
    });

    gpsSub.subscribe((msg: any) => {
      setT(prev => ({
        ...prev,
        lat: msg.lat,
        lon: msg.lon,
      }));
    });

    return () => {
      posSub.unsubscribe();
      statusSub.unsubscribe();
      batSub.unsubscribe();
      attSub.unsubscribe();
      gpsSub.unsubscribe();
    };
  }, [ros, connected]);

  const batteryColor =
    t.battery == null
      ? 'text-neutral-500'
      : t.battery > 30
      ? 'text-green-400'
      : t.battery > 15
      ? 'text-yellow-400'
      : 'text-red-500';

  const warning = BATTERY_WARNING[t.batteryWarning] ?? BATTERY_WARNING[0];

  return (
    <div className="p-2 flex-1 overflow-y-auto scrollbar-hide">
      <h2 className="text-sm font-bold mb-2 text-cyan-400 uppercase tracking-wider">Flight Telemetry</h2>

      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <Tile label="ALTITUDE" value={t.alt.toFixed(1)} unit="m" />
        <Tile label="GROUND SPEED" value={t.speed.toFixed(1)} unit="m/s" />
        <Tile
          label="BATTERY"
          value={t.battery == null ? '—' : t.battery.toFixed(0)}
          unit={t.battery == null ? '' : '%'}
          valueClass={batteryColor}
          sub={t.voltage != null ? `${t.voltage.toFixed(1)}V` : warning.label}
          subClass={warning.color}
        />
        <Tile label="MODE" value={t.mode} valueClass="text-yellow-400 text-sm" />
      </div>

      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <Tile
          label="LATITUDE"
          value={t.lat != null ? t.lat.toFixed(6) : '—'}
          valueClass="text-[11px] font-semibold text-cyan-200"
        />
        <Tile
          label="LONGITUDE"
          value={t.lon != null ? t.lon.toFixed(6) : '—'}
          valueClass="text-[11px] font-semibold text-cyan-200"
        />
      </div>

      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <div
          className={`rounded-lg p-1.5 border text-xs font-mono flex flex-col justify-center ${
            t.armed
              ? 'bg-amber-950/30 border-amber-700 text-amber-300'
              : 'bg-neutral-900 border-neutral-800 text-neutral-400'
          }`}
        >
          <div className="text-[9px] uppercase opacity-75 leading-none mb-1">Arming</div>
          <div className="text-xs font-bold leading-none">{t.armed ? 'ARMED' : 'DISARMED'}</div>
        </div>
        <div
          className={`rounded-lg p-1.5 border text-xs font-mono flex flex-col justify-center ${
            t.preflightOk
              ? 'bg-green-950/30 border-green-800 text-green-300'
              : 'bg-red-950/30 border-red-800 text-red-300'
          }`}
        >
          <div className="text-[9px] uppercase opacity-75 leading-none mb-1">Preflight</div>
          <div className="text-xs font-bold leading-none">{t.preflightOk ? 'OK' : 'CHECK'}</div>
        </div>
      </div>

      <div className="bg-neutral-900 rounded-lg p-1.5 border border-neutral-800">
        <div className="text-[9px] text-neutral-500 mb-1 uppercase leading-none">Attitude</div>
        <div className="grid grid-cols-3 gap-1 text-[11px] font-mono">
          <Att label="R" value={rad2deg(t.roll)} />
          <Att label="P" value={rad2deg(t.pitch)} />
          <Att label="Y" value={rad2deg(t.yaw)} />
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  unit,
  valueClass = 'text-white',
  sub,
  subClass,
}: {
  label: string;
  value: string;
  unit?: string;
  valueClass?: string;
  sub?: string;
  subClass?: string;
}) {
  return (
    <div className="bg-neutral-900 rounded-lg p-1.5 border border-neutral-800 flex flex-col justify-center">
      <div className="text-[9px] text-neutral-500 mb-0.5 uppercase leading-none">{label}</div>
      <div className={`text-base font-mono leading-tight ${valueClass}`}>
        {value}
        {unit ? <span className="text-[10px] text-neutral-400 ml-0.5">{unit}</span> : null}
      </div>
      {sub ? <div className={`text-[9px] font-mono leading-none mt-0.5 ${subClass ?? 'text-neutral-500'}`}>{sub}</div> : null}
    </div>
  );
}

function Att({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-neutral-500 text-[9px] uppercase">{label}:</span>
      <span className="text-cyan-300">{value.toFixed(0)}°</span>
    </div>
  );
}
