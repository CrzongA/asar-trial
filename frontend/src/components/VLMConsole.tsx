import React, { useState, useEffect, useRef } from 'react';

interface LogEntry {
  id: number;
  timestamp: string;
  type: 'info' | 'detection' | 'reasoning' | 'action';
  message: string;
}

export default function VLMConsole() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Mock VLM logs stream
    const mockLogs = [
      { type: 'info', message: 'VLM Agent Initialized (Qwen3-VL-235B)' },
      { type: 'reasoning', message: 'Analyzing frame at 47.3977N, 8.5455E' },
      { type: 'detection', message: 'Target potential: Red jacket detected (Conf: 0.89)' },
      { type: 'action', message: 'Generating waypoint to inspect target...' }
    ] as const;

    let index = 0;
    const interval = setInterval(() => {
      if (index < mockLogs.length) {
        setLogs(prev => [...prev, { 
          id: Date.now(), 
          timestamp: new Date().toLocaleTimeString(),
          ...mockLogs[index]
        }]);
        index++;
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

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
    <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-5 shadow-lg flex-grow flex flex-col min-h-[300px]">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-purple-400">VLM Reason/Act Log</h2>
        <span className="text-xs bg-neutral-900 px-2 py-1 rounded text-neutral-400 border border-neutral-700">vLLM Backend</span>
      </div>
      
      <div className="flex-grow bg-neutral-900 rounded-lg p-3 border border-neutral-800 overflow-y-auto font-mono text-xs">
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
