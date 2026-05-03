import React, { useState, useEffect } from 'react';

export default function TelemetryDashboard() {
  const [telemetry, setTelemetry] = useState({
    alt: 0,
    speed: 0,
    battery: 100,
    mode: 'STABILIZED'
  });

  useEffect(() => {
    // Mock telemetry updates
    const interval = setInterval(() => {
      setTelemetry(prev => ({
        ...prev,
        alt: Math.max(0, prev.alt + (Math.random() - 0.5) * 0.5),
        speed: Math.max(0, prev.speed + (Math.random() - 0.5) * 2),
        battery: Math.max(0, prev.battery - 0.01)
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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
