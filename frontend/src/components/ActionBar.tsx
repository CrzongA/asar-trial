"use client";

import React, { useEffect, useState } from 'react';
import * as ROSLIB from 'roslib';
import { useRos } from './RosProvider';

const ARMING_STATE_ARMED = 2;

export default function ActionBar() {
  const { ros, connected } = useRos();
  const [armingState, setArmingState] = useState<number>(0);
  const [landed, setLanded] = useState(true);
  const [confirmLand, setConfirmLand] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!ros || !connected) return;
    const sub = new ROSLIB.Topic({
      ros,
      name: '/fmu/out/vehicle_status_v4',
      messageType: 'px4_msgs/msg/VehicleStatus',
    });
    sub.subscribe((msg: any) => setArmingState(msg.arming_state));

    const landSub = new ROSLIB.Topic({
      ros,
      name: '/fmu/out/vehicle_land_detected',
      messageType: 'px4_msgs/msg/VehicleLandDetected',
    });
    landSub.subscribe((msg: any) => setLanded(!!msg.landed));

    return () => {
      sub.unsubscribe();
      landSub.unsubscribe();
    };
  }, [ros, connected]);

  const armed = armingState === ARMING_STATE_ARMED;
  const disarmDisabled = armed && !landed;

  const sendArmDisarm = (arm: boolean) => {
    if (!ros) return;
    const topic = new ROSLIB.Topic({
      ros,
      name: '/fmu/in/vehicle_command',
      messageType: 'px4_msgs/msg/VehicleCommand',
    });
    const ts = Date.now() * 1000;
    topic.publish({
      timestamp: ts,
      param1: arm ? 1.0 : 0.0,
      param2: 0.0,
      param3: 0.0,
      param4: 0.0,
      param5: 0.0,
      param6: 0.0,
      param7: 0.0,
      command: 400,
      target_system: 1,
      target_component: 1,
      source_system: 255,
      source_component: 0,
      from_external: true,
    } as any);
  };

  const sendLand = () => {
    if (!ros) return;
    const topic = new ROSLIB.Topic({
      ros,
      name: '/mission/land',
      messageType: 'std_msgs/msg/Empty',
    });
    topic.publish({} as any);
    setConfirmLand(false);
  };

  const sendReset = () => {
    if (!ros) return;
    const topic = new ROSLIB.Topic({
      ros,
      name: '/mission/reset',
      messageType: 'std_msgs/msg/Empty',
    });
    topic.publish({} as any);
    setConfirmReset(false);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => sendArmDisarm(!armed)}
        disabled={!connected || disarmDisabled}
        className={`px-4 py-2 rounded-lg font-mono text-sm font-semibold border transition disabled:opacity-40 disabled:cursor-not-allowed ${
          armed
            ? 'bg-amber-600/20 border-amber-500 text-amber-300 hover:bg-amber-600/30'
            : 'bg-cyan-600/20 border-cyan-500 text-cyan-300 hover:bg-cyan-600/30'
        }`}
      >
        {armed ? 'DISARM' : 'ARM'}
      </button>
      <button
        onClick={() => setConfirmLand(true)}
        disabled={!connected}
        className="px-4 py-2 rounded-lg font-mono text-sm font-semibold bg-red-600/20 border border-red-500 text-red-300 hover:bg-red-600/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        EMERGENCY LAND
      </button>
      <button
        onClick={() => setConfirmReset(true)}
        disabled={!connected}
        className="px-4 py-2 rounded-lg font-mono text-sm font-semibold bg-neutral-600/20 border border-neutral-500 text-neutral-300 hover:bg-neutral-600/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        RESET
      </button>

      {confirmLand && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-red-500/50 rounded-xl p-6 max-w-sm shadow-2xl">
            <h3 className="text-red-400 text-lg font-bold mb-2">Confirm Emergency Land</h3>
            <p className="text-neutral-300 text-sm mb-5">
              The drone will descend and disarm immediately. Continue?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmLand(false)}
                className="px-4 py-2 rounded-lg text-sm bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700"
              >
                Cancel
              </button>
              <button
                onClick={sendLand}
                className="px-4 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-500"
              >
                Land Now
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmReset && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-500/50 rounded-xl p-6 max-w-sm shadow-2xl">
            <h3 className="text-neutral-300 text-lg font-bold mb-2">Confirm Aircraft Reset</h3>
            <p className="text-neutral-400 text-sm mb-5">
              The drone will be teleported to spawn and PX4 will reboot. This will interrupt telemetry briefly. Continue?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmReset(false)}
                className="px-4 py-2 rounded-lg text-sm bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700"
              >
                Cancel
              </button>
              <button
                onClick={sendReset}
                className="px-4 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-500"
              >
                Reset Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
