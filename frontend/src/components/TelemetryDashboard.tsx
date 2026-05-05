import React, { useState, useEffect } from 'react';
import { useRos } from './RosProvider';
import * as ROSLIB from 'roslib';

export default function TelemetryDashboard() {
  const { ros, connected } = useRos();
  const [telemetry, setTelemetry] = useState({
    alt: 0,
    speed: 0,
    battery: 100,
    mode: 'WAITING'
  });

  useEffect(() => {
    if (!ros || !connected) return;

    const posSub = new ROSLIB.Topic({
      ros: ros,
      name: '/fmu/out/vehicle_local_position_v1',
      messageType: 'px4_msgs/msg/VehicleLocalPosition'
    });

    const statusSub = new ROSLIB.Topic({
      ros: ros,
      name: '/fmu/out/vehicle_status_v4',
      messageType: 'px4_msgs/msg/VehicleStatus'
    });

    posSub.subscribe((msg: any) => {
      setTelemetry(prev => ({
        ...prev,
        alt: -msg.z, // PX4 NED: z is down, so altitude is -z
        speed: Math.sqrt(msg.vx * msg.vx + msg.vy * msg.vy + msg.vz * msg.vz)
      }));
    });

    statusSub.subscribe((msg: any) => {
      const modes = {
        1: 'MANUAL',
        3: 'POSITION',
        6: 'OFFBOARD'
      };
      setTelemetry(prev => ({
        ...prev,
        mode: (modes as any)[msg.nav_state] || `STATE_${msg.nav_state}`
      }));
    });

    return () => {
      posSub.unsubscribe();
      statusSub.unsubscribe();
    };
  }, [ros, connected]);

  return (
    <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-5 shadow-lg">
      <h2 className="text-lg font-semibold mb-4 text-cyan-400">Flight Telemetry</h2>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-neutral-900 rounded-lg p-3 border border-neutral-800">
          <div className="text-xs text-neutral-500 mb-1">ALTITUDE</div>
          <div className="text-2xl font-mono text-white">{telemetry.alt.toFixed(1)}<span className="text-sm text-neutral-400 ml-1">m</span></div>
        </div>
        
        <div className="bg-neutral-900 rounded-lg p-3 border border-neutral-800">
          <div className="text-xs text-neutral-500 mb-1">GROUND SPEED</div>
          <div className="text-2xl font-mono text-white">{telemetry.speed.toFixed(1)}<span className="text-sm text-neutral-400 ml-1">m/s</span></div>
        </div>

        <div className="bg-neutral-900 rounded-lg p-3 border border-neutral-800">
          <div className="text-xs text-neutral-500 mb-1">BATTERY</div>
          <div className="flex items-end gap-2">
            <div className={`text-2xl font-mono ${telemetry.battery > 20 ? 'text-green-400' : 'text-red-500'}`}>
              {telemetry.battery.toFixed(0)}<span className="text-sm ml-1">%</span>
            </div>
          </div>
        </div>

        <div className="bg-neutral-900 rounded-lg p-3 border border-neutral-800">
          <div className="text-xs text-neutral-500 mb-1">FLIGHT MODE</div>
          <div className="text-sm font-mono text-yellow-400 mt-2">{telemetry.mode}</div>
        </div>
      </div>
    </div>
  );
}
