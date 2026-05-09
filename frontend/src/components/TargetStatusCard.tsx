'use client';

import React, { useEffect, useState } from 'react';
import * as ROSLIB from 'roslib';

import { useRos } from './RosProvider';

interface TargetStatus {
  found: boolean;
  missionId: string;
  health: string;
  terrain: string;
  distanceToSafetyM: number;
  latitude: number;
  longitude: number;
  altitudeM: number;
  confidence: number;
  rationale: string;
}

export default function TargetStatusCard({ data }: { data?: TargetStatus | null }) {
  const { ros, connected } = useRos();
  const [liveTarget, setLiveTarget] = useState<TargetStatus | null>(null);

  useEffect(() => {
    if (data || !ros || !connected) return;
    const sub = new ROSLIB.Topic({
      ros,
      name: '/mission/target_status',
      messageType: 'asar_msgs/msg/TargetStatus',
    });
    sub.subscribe(raw => {
      const m = raw as Record<string, unknown>;
      setLiveTarget({
        found: !!m.found,
        missionId: (m.mission_id as string) ?? '',
        health: (m.health as string) ?? 'unknown',
        terrain: (m.terrain as string) ?? 'unknown',
        distanceToSafetyM: (m.distance_to_safety_m as number) ?? 0,
        latitude: (m.latitude as number) ?? 0,
        longitude: (m.longitude as number) ?? 0,
        altitudeM: (m.altitude_m as number) ?? 0,
        confidence: (m.confidence as number) ?? 0,
        rationale: (m.vlm_rationale as string) ?? '',
      });
    });
    return () => sub.unsubscribe();
  }, [ros, connected, data]);

  const target = data !== undefined ? data : liveTarget;

  if (!target || !target.found) {
    return (
      <div className="text-xs text-neutral-500 px-3 py-2 italic text-center bg-neutral-900/30 rounded border border-neutral-800">
        No target acquired for this mission.
      </div>
    );
  }

  return (
    <div className="px-3 py-3 bg-neutral-900 border border-red-500/30 rounded-xl text-xs flex flex-col gap-2.5 shadow-lg shadow-red-950/10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"></span>
          <span className="text-red-400 font-bold uppercase tracking-tight">Target Acquired</span>
        </div>
        <span className="text-neutral-500 font-mono bg-neutral-800 px-1.5 py-0.5 rounded text-[10px]">
          CONF {target.confidence.toFixed(2)}
        </span>
      </div>
      
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-neutral-300">
        <div className="flex flex-col">
          <span className="text-[9px] text-neutral-600 uppercase font-bold leading-none mb-1">Health</span>
          <span className="text-white font-medium">{target.health}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-neutral-600 uppercase font-bold leading-none mb-1">Terrain</span>
          <span className="text-white font-medium">{target.terrain}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-neutral-600 uppercase font-bold leading-none mb-1">Distance to Safety</span>
          <span className="text-cyan-400 font-medium">{target.distanceToSafetyM.toFixed(1)} m</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-neutral-600 uppercase font-bold leading-none mb-1">Altitude</span>
          <span className="text-white font-medium">{target.altitudeM.toFixed(1)} m</span>
        </div>
        <div className="flex flex-col col-span-2">
          <span className="text-[9px] text-neutral-600 uppercase font-bold leading-none mb-1">Coordinates</span>
          <span className="font-mono text-cyan-200 text-[11px]">{target.latitude.toFixed(6)}, {target.longitude.toFixed(6)}</span>
        </div>
      </div>

      {target.rationale && (
        <div className="mt-1 pt-2 border-t border-neutral-800 text-purple-300/90 italic leading-relaxed text-[11px] bg-purple-950/10 -mx-3 -mb-3 p-3 rounded-b-xl">
          &ldquo;{target.rationale}&rdquo;
        </div>
      )}
    </div>
  );
}

