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
  const [engaged, setEngaged] = useState(false);
  const [gimbalOpen, setGimbalOpen] = useState(false);

  const leftRef = useRef<StickValue>({ x: 0, y: 0 });
  const rightRef = useRef<StickValue>({ x: 0, y: 0 });
  const gimbalRef = useRef<StickValue>({ x: 0, y: 0 });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const topicRef = useRef<ROSLIB.Topic | null>(null);
  const gimbalTopicRef = useRef<ROSLIB.Topic | null>(null);

  useEffect(() => {
    if (!ros || !connected) return;

    topicRef.current = new ROSLIB.Topic({
      ros,
      name: '/teleop/manual_input',
      messageType: 'px4_msgs/msg/ManualControlSetpoint',
    });

    gimbalTopicRef.current = new ROSLIB.Topic({
      ros,
      name: '/teleop/gimbal_input',
      messageType: 'px4_msgs/msg/GimbalManagerSetManualControl',
    });

    intervalRef.current = setInterval(() => {
      const ts = Date.now() * 1000;

      // Only publish movement if engaged
      if (engaged && topicRef.current) {
        const left = leftRef.current;
        const right = rightRef.current;
        topicRef.current.publish({
          timestamp: ts,
          timestamp_sample: ts,
          valid: true,
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
      }

      // Always publish gimbal if connected
      if (gimbalTopicRef.current) {
        const gimbal = gimbalRef.current;
        gimbalTopicRef.current.publish({
          timestamp: ts,
          origin_sysid: 1,
          origin_compid: 1,
          target_system: 1,
          target_component: 1,
          flags: 0,
          gimbal_device_id: 0,
          pitch: 0.0,
          yaw: 0.0,
          pitch_rate: clamp(gimbal.y),
          yaw_rate: clamp(gimbal.x),
        } as any);
      }
    }, 20);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      topicRef.current = null;
      gimbalTopicRef.current = null;
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
  const handleGimbal = (e: any) => {
    gimbalRef.current = { x: e.x ?? 0, y: e.y ?? 0 };
  };
  const handleGimbalStop = () => {
    gimbalRef.current = { x: 0, y: 0 };
  };

  return (
    <div className="pointer-events-none select-none touch-none">
      {/* Side Trigger Button for Gimbal */}
      <button
        onClick={() => setGimbalOpen(!gimbalOpen)}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-[70] pointer-events-auto bg-amber-600/20 hover:bg-amber-600/40 border-y border-l border-amber-500/50 text-amber-300 py-6 px-1.5 rounded-l-2xl transition-all duration-300 group flex flex-col items-center gap-4 shadow-2xl backdrop-blur-md"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-500 ${gimbalOpen ? 'rotate-180' : ''}`}
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span className="whitespace-nowrap uppercase text-[10px] font-bold tracking-tighter [writing-mode:vertical-lr] rotate-180 py-2">
          Camera Control
        </span>
      </button>

      {/* Independent Gimbal Block */}
      <div
        className={`fixed right-10 top-1/2 -translate-y-1/2 z-[65] pointer-events-auto bg-neutral-900/90 backdrop-blur-2xl p-6 rounded-3xl border border-neutral-700/50 shadow-2xl transition-all duration-500 ease-in-out transform ${
          gimbalOpen ? 'translate-x-0 opacity-100' : 'translate-x-20 opacity-0 pointer-events-none'
        }`}
      >
        <StickBox label="Gimbal Control" subLabel="Y: tilt  X: pan">
          <Joystick
            size={140}
            baseColor="#111827"
            stickColor="#f59e0b"
            throttle={50}
            move={handleGimbal}
            stop={handleGimbalStop}
          />
        </StickBox>
      </div>

      {/* Floating Controls Overlay */}
      <div className="fixed inset-0 pointer-events-none z-[60] flex flex-col justify-end p-8">
        <div className="flex justify-between items-end w-full">
          {/* Left Block: Throttle/Yaw */}
          <div
            className={`pointer-events-auto bg-neutral-900/80 backdrop-blur-xl p-6 rounded-3xl border border-neutral-700/50 shadow-2xl transition-all duration-700 ease-out transform ${
              engaged ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-32 opacity-0 scale-90'
            }`}
          >
            <StickBox label="Throttle / Yaw" subLabel="Y: throttle  X: yaw" disabled={!engaged}>
              <Joystick
                size={140}
                baseColor="#111827"
                stickColor="#06b6d4"
                throttle={50}
                disabled={!engaged}
                move={handleLeft}
                stop={handleLeftStop}
              />
            </StickBox>
          </div>

          {/* Center: Take Control Button */}
          <div className="pointer-events-auto flex flex-col items-center gap-3">
            {engaged && (
              <div className="px-3 py-1 bg-red-500/20 border border-red-500/50 rounded-full text-[10px] font-mono text-red-400 animate-pulse">
                LIVE TELEOP ACTIVE
              </div>
            )}
            <button
              onClick={() => setEngaged(e => !e)}
              disabled={!connected}
              className={`px-6 py-2.5 rounded-2xl text-xs font-bold tracking-widest border-2 transition-all duration-300 shadow-xl disabled:opacity-40 hover:scale-105 active:scale-95 ${
                engaged
                  ? 'bg-red-600/20 border-red-500 text-red-300 hover:bg-red-600/30'
                  : 'bg-emerald-600/20 border-emerald-500 text-emerald-300 hover:bg-emerald-600/30'
              }`}
            >
              {engaged ? 'RELEASE CONTROL' : 'TAKE CONTROL'}
            </button>
          </div>

          {/* Right Block: Pitch/Roll */}
          <div
            className={`pointer-events-auto bg-neutral-900/80 backdrop-blur-xl p-6 rounded-3xl border border-neutral-700/50 shadow-2xl transition-all duration-700 ease-out transform ${
              engaged ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-32 opacity-0 scale-90'
            }`}
          >
            <StickBox label="Pitch / Roll" subLabel="Y: pitch  X: roll" disabled={!engaged}>
              <Joystick
                size={140}
                baseColor="#111827"
                stickColor="#06b6d4"
                throttle={50}
                disabled={!engaged}
                move={handleRight}
                stop={handleRightStop}
              />
            </StickBox>
          </div>
        </div>
      </div>
    </div>
  );
}

function StickBox({
  label,
  subLabel,
  children,
  disabled = false,
}: {
  label: string;
  subLabel: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center gap-1 transition-opacity duration-200 select-none touch-none ${disabled ? 'opacity-40 grayscale-[0.5]' : 'opacity-100'}`}>
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
