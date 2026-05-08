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

export default function TargetStatusCard() {
  const { ros, connected } = useRos();
  const [target, setTarget] = useState<TargetStatus | null>(null);

  useEffect(() => {
    if (!ros || !connected) return;
    const sub = new ROSLIB.Topic({
      ros,
      name: '/mission/target_status',
      messageType: 'asar_msgs/msg/TargetStatus',
    });
    sub.subscribe(raw => {
      const m = raw as Record<string, unknown>;
      setTarget({
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
  }, [ros, connected]);

  if (!target || !target.found) {
    return (
      <div className="text-xs text-neutral-500 px-3 py-2 italic">
        No target acquired yet.
      </div>
    );
  }

  return (
    <div className="px-3 py-2 bg-neutral-900 border border-red-500/30 rounded text-xs flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-red-400 font-bold uppercase">Target Acquired</span>
        <span className="text-neutral-500 font-mono">conf {target.confidence.toFixed(2)}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-neutral-300">
        <span className="text-neutral-500">health</span>
        <span>{target.health}</span>
        <span className="text-neutral-500">terrain</span>
        <span>{target.terrain}</span>
        <span className="text-neutral-500">to safety</span>
        <span>{target.distanceToSafetyM.toFixed(1)} m</span>
        <span className="text-neutral-500">lat / lon</span>
        <span className="font-mono">{target.latitude.toFixed(5)}, {target.longitude.toFixed(5)}</span>
        <span className="text-neutral-500">altitude</span>
        <span>{target.altitudeM.toFixed(1)} m</span>
        <span className="text-neutral-500">mission id</span>
        <span className="font-mono">{target.missionId}</span>
      </div>
      {target.rationale && (
        <div className="mt-1 pt-1 border-t border-neutral-800 text-purple-300 italic">
          &ldquo;{target.rationale}&rdquo;
        </div>
      )}
    </div>
  );
}
