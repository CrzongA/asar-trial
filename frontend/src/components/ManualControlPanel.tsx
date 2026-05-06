"use client";

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import * as ROSLIB from 'roslib';
import { useRos } from './RosProvider';

const Joystick = dynamic(
  () => import('react-joystick-component').then(m => m.Joystick),
  { ssr: false },
);

type StickValue = { x: number; y: number };

export default function ManualControlPanel() {
  const { ros, connected } = useRos();
  const [collapsed, setCollapsed] = useState(true);
  const [engaged, setEngaged] = useState(false);

  const leftRef = useRef<StickValue>({ x: 0, y: 0 });
  const rightRef = useRef<StickValue>({ x: 0, y: 0 });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const topicRef = useRef<ROSLIB.Topic | null>(null);

  useEffect(() => {
    if (!engaged || !ros || !connected) return;

    topicRef.current = new ROSLIB.Topic({
      ros,
      name: '/teleop/manual_input',
      messageType: 'px4_msgs/msg/ManualControlSetpoint',
    });

    intervalRef.current = setInterval(() => {
      if (!topicRef.current) return;
      const left = leftRef.current;
      const right = rightRef.current;
      const ts = Date.now() * 1000;
      topicRef.current.publish({
        timestamp: ts,
        timestamp_sample: ts,
        valid: true,
        // px4_msgs/ManualControlSetpoint.SOURCE_MAVLINK_0 = 2 (1 = SOURCE_RC,
        // which PX4 rejects when COM_RC_IN_MODE=1).
        data_source: 2,
        roll: clamp(right.x),
        pitch: clamp(right.y),
        yaw: clamp(left.x),
        throttle: clamp(left.y),
        flaps: 0.0,
        aux1: 0.0,
        aux2: 0.0,
        aux3: 0.0,
        aux4: 0.0,
        aux5: 0.0,
        aux6: 0.0,
        sticks_moving: true,
        buttons: 0,
      } as any);
    }, 20);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      topicRef.current = null;
    };
  }, [engaged, ros, connected]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleLeft = (e: any) => {
    leftRef.current = { x: e.x ?? 0, y: e.y ?? 0 };
  };
  const handleLeftStop = () => {
    leftRef.current = { x: 0, y: 0 };
  };
  const handleRight = (e: any) => {
    rightRef.current = { x: e.x ?? 0, y: e.y ?? 0 };
  };
  const handleRightStop = () => {
    rightRef.current = { x: 0, y: 0 };
  };

  return (
    <div
      className={`bg-neutral-900 border-t border-neutral-700 transition-all duration-200 ${
        collapsed ? 'h-12' : 'h-72'
      } flex flex-col`}
    >
      <div className="flex items-center justify-between px-4 h-12 shrink-0 border-b border-neutral-800">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center gap-2 text-neutral-300 hover:text-white"
        >
          <span
            className={`inline-block transition-transform ${collapsed ? '' : 'rotate-180'}`}
          >
            ▲
          </span>
          <span className="text-sm font-semibold">Manual Control</span>
        </button>
        {!collapsed && (
          <button
            onClick={() => setEngaged(e => !e)}
            disabled={!connected}
            className={`px-3 py-1 rounded text-xs font-mono font-semibold border transition disabled:opacity-40 ${
              engaged
                ? 'bg-red-600/30 border-red-500 text-red-300 hover:bg-red-600/40'
                : 'bg-emerald-600/20 border-emerald-500 text-emerald-300 hover:bg-emerald-600/30'
            }`}
          >
            {engaged ? 'RELEASE CONTROL' : 'TAKE CONTROL'}
          </button>
        )}
        {collapsed && engaged && (
          <span className="text-xs font-mono text-red-400 animate-pulse">● LIVE TELEOP</span>
        )}
      </div>

      {!collapsed && (
        <div className="flex-1 flex items-center justify-around px-6 py-3">
          <StickBox label="Throttle / Yaw" subLabel="Y: throttle  X: yaw">
            <Joystick
              size={140}
              baseColor="#1f2937"
              stickColor="#06b6d4"
              throttle={50}
              move={handleLeft}
              stop={handleLeftStop}
            />
          </StickBox>
          <StickBox label="Pitch / Roll" subLabel="Y: pitch  X: roll">
            <Joystick
              size={140}
              baseColor="#1f2937"
              stickColor="#06b6d4"
              throttle={50}
              move={handleRight}
              stop={handleRightStop}
            />
          </StickBox>
        </div>
      )}
    </div>
  );
}

function StickBox({
  label,
  subLabel,
  children,
}: {
  label: string;
  subLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-xs text-neutral-400 font-mono uppercase">{label}</div>
      {children}
      <div className="text-[10px] text-neutral-500 font-mono">{subLabel}</div>
    </div>
  );
}

function clamp(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}
