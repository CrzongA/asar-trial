'use client';

import React, { useEffect, useRef, useState } from 'react';

import { useRos } from './RosProvider';
import * as ROSLIB from 'roslib';

type LogKind = 'info' | 'state' | 'tool_call' | 'tool_result' | 'vlm_reason' | 'detection' | 'error' | 'action' | 'paused';

interface AgentLogEntry {
  ts: number;
  kind: LogKind;
  state: string;
  data: Record<string, unknown>;
}

interface DisplayEntry {
  id: number;
  timestamp: string;
  kind: LogKind;
  state: string;
  data: Record<string, unknown>;
}

const KIND_COLOR: Record<LogKind, string> = {
  info: 'text-blue-400',
  state: 'text-cyan-300',
  tool_call: 'text-emerald-400',
  tool_result: 'text-emerald-300',
  vlm_reason: 'text-purple-400',
  detection: 'text-red-400',
  error: 'text-amber-400',
  action: 'text-green-400',
  paused: 'text-amber-500',
};

function formatHeadline(entry: AgentLogEntry): string {
  const data = entry.data ?? {};
  if (typeof data === 'object' && 'msg' in data) {
    return String(data.msg);
  }
  if (entry.kind === 'tool_call' && 'tool' in data) {
    return `tool ${data.tool}`;
  }
  if (entry.kind === 'detection' && 'label' in data && 'confidence' in data) {
    return `${data.label} (conf ${(data.confidence as number).toFixed(2)}, streak ${data.streak ?? '?'})`;
  }
  if (entry.kind === 'vlm_reason' && 'rationale' in data) {
    return String(data.rationale);
  }
  return JSON.stringify(data);
}

export default function VLMConsole() {
  const { ros, connected } = useRos();
  const [logs, setLogs] = useState<DisplayEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const logsEndRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  useEffect(() => {
    if (!ros || !connected) return;

    const sub = new ROSLIB.Topic({
      ros,
      name: '/sar/agent_log',
      messageType: 'std_msgs/msg/String',
    });

    setLogs([{
      id: idRef.current++,
      timestamp: new Date().toLocaleTimeString(),
      kind: 'info',
      state: 'IDLE',
      data: { msg: 'Agent log connected. Awaiting events...' },
    }]);

    sub.subscribe(raw => {
      const msg = raw as { data: string };
      let entry: AgentLogEntry;
      try {
        entry = JSON.parse(msg.data) as AgentLogEntry;
      } catch {
        entry = { ts: Date.now() / 1000, kind: 'info', state: 'UNKNOWN', data: { msg: msg.data } };
      }
      // BRIEFING -> reset on a new mission so each mission starts fresh
      if (entry.kind === 'state' && typeof entry.data === 'object' && 'msg' in entry.data) {
        const text = String(entry.data.msg);
        if (text.includes('-> BRIEFING')) {
          setLogs([]);
          setExpanded(new Set());
        }
      }
      setLogs(prev => [...prev, {
        id: idRef.current++,
        timestamp: new Date(entry.ts * 1000).toLocaleTimeString(),
        kind: entry.kind,
        state: entry.state,
        data: entry.data ?? {},
      }]);
    });

    return () => sub.unsubscribe();
  }, [ros, connected]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const toggle = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-4 flex-1 min-h-0 flex flex-col">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-base font-semibold text-purple-400">Agent Reason/Act Log</h2>
        <span className="text-xs bg-neutral-900 px-2 py-1 rounded text-neutral-400 border border-neutral-700">
          /sar/agent_log
        </span>
      </div>

      <div className="flex-1 min-h-0 bg-neutral-900 rounded-lg p-3 border border-neutral-800 overflow-y-auto overflow-x-auto font-mono text-xs">
        {logs.map(log => {
          const isOpen = expanded.has(log.id);
          return (
            <div
              key={log.id}
              className="mb-1.5 border-l-2 border-neutral-700 pl-2 cursor-pointer hover:bg-neutral-800/40 rounded-r"
              onClick={() => toggle(log.id)}
            >
              <div className="flex gap-2 items-baseline">
                <span className="text-neutral-500">[{log.timestamp}]</span>
                <span className="text-neutral-600 uppercase text-[10px]">{log.state}</span>
                <span className={`uppercase text-[10px] ${KIND_COLOR[log.kind] ?? (log.state === 'PAUSED' ? 'text-amber-500' : 'text-neutral-400')}`}>
                  {log.kind}
                </span>
                <span className={`flex-1 whitespace-pre ${KIND_COLOR[log.kind] ?? 'text-neutral-300'}`}>
                  {formatHeadline({ ts: 0, kind: log.kind, state: log.state, data: log.data })}
                </span>
              </div>
              {isOpen && (
                <pre className="mt-1 ml-1 p-2 text-[10px] bg-black/40 rounded text-neutral-300 whitespace-pre-wrap">
                  {JSON.stringify(log.data, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
