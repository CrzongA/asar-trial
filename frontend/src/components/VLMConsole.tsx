import React, { useState, useEffect, useRef } from 'react';

interface LogEntry {
  id: number;
  timestamp: string;
  type: 'info' | 'detection' | 'reasoning' | 'action';
  message: string;
}

import { useRos } from './RosProvider';
import * as ROSLIB from 'roslib';

export default function VLMConsole() {
  const { ros, connected } = useRos();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ros || !connected) return;

    const vlmSub = new ROSLIB.Topic({
      ros: ros,
      name: '/vlm/target_detections',
      messageType: 'std_msgs/msg/String'
    });

    setLogs([{ 
      id: Date.now(), 
      timestamp: new Date().toLocaleTimeString(), 
      type: 'info', 
      message: 'VLM Agent Connected (Live Feed)' 
    }]);

    vlmSub.subscribe((msg: any) => {
      try {
        const data = JSON.parse(msg.data);
        setLogs(prev => [...prev, {
          id: Date.now(),
          timestamp: new Date().toLocaleTimeString(),
          type: 'detection',
          message: `Target detected: ${data.target} (Conf: ${data.confidence})`
        }]);
      } catch (e) {
        setLogs(prev => [...prev, {
          id: Date.now(),
          timestamp: new Date().toLocaleTimeString(),
          type: 'info',
          message: `Raw message: ${msg.data}`
        }]);
      }
    });

    return () => vlmSub.unsubscribe();
  }, [ros, connected]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getColor = (type: string) => {
    switch(type) {
      case 'detection': return 'text-red-400';
      case 'reasoning': return 'text-purple-400';
      case 'action': return 'text-green-400';
      default: return 'text-blue-400';
    }
  };

  return (
    <div className="p-4 flex-1 min-h-0 flex flex-col">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-base font-semibold text-purple-400">VLM Reason/Act Log</h2>
        <span className="text-xs bg-neutral-900 px-2 py-1 rounded text-neutral-400 border border-neutral-700">vLLM Backend</span>
      </div>

      <div className="flex-1 min-h-0 bg-neutral-900 rounded-lg p-3 border border-neutral-800 overflow-y-auto font-mono text-xs">
        {logs.map(log => (
          <div key={log.id} className="mb-2 border-l-2 border-neutral-700 pl-2">
            <span className="text-neutral-500">[{log.timestamp}]</span>{' '}
            <span className={getColor(log.type)}>{log.message}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
