'use client';

import React, { useEffect, useState } from 'react';
import * as ROSLIB from 'roslib';

import { useRos } from './RosProvider';

const STATE_STYLE: Record<string, { dot: string; text: string }> = {
  IDLE: { dot: 'bg-neutral-500', text: 'text-neutral-300' },
  BRIEFING: { dot: 'bg-blue-400 animate-pulse', text: 'text-blue-300' },
  PLANNING: { dot: 'bg-blue-400 animate-pulse', text: 'text-blue-300' },
  SEARCHING: { dot: 'bg-cyan-400 animate-pulse', text: 'text-cyan-300' },
  CONFIRMING: { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300' },
  SECURED: { dot: 'bg-green-500', text: 'text-green-300' },
  ABORTED: { dot: 'bg-red-500', text: 'text-red-300' },
};

export default function SARStatusBadge() {
  const { ros, connected } = useRos();
  const [state, setState] = useState<string>('IDLE');

  useEffect(() => {
    if (!ros || !connected) return;
    const sub = new ROSLIB.Topic({
      ros,
      name: '/sar/state',
      messageType: 'std_msgs/msg/String',
    });
    sub.subscribe(raw => setState((raw as { data?: string })?.data ?? 'IDLE'));
    return () => sub.unsubscribe();
  }, [ros, connected]);

  const style = STATE_STYLE[state] ?? STATE_STYLE.IDLE;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-800 rounded-full border border-neutral-700">
      <div className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
      <span className={`text-xs font-mono uppercase tracking-wider ${style.text}`}>SAR · {state}</span>
    </div>
  );
}
