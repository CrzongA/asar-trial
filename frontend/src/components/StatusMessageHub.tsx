"use client";

import React, { useEffect, useState, useCallback } from 'react';
import * as ROSLIB from 'roslib';
import { useRos } from './RosProvider';

type Message = {
  id: string;
  text: string;
  type: 'info' | 'warn' | 'error' | 'success';
  persistent?: boolean;
  timestamp: string;
};

const COMMAND_RESULT: Record<number, string> = {
  0: 'ACCEPTED',
  1: 'TEMPORARILY REJECTED',
  2: 'DENIED',
  3: 'UNSUPPORTED',
  4: 'FAILED',
  5: 'IN PROGRESS',
  6: 'CANCELLED',
};

const COMMAND_NAMES: Record<number, string> = {
  400: 'Arm/Disarm',
  176: 'Set Mode',
  22: 'Takeoff',
  21: 'Land',
  20: 'Return to Launch',
  19: 'Loiter',
  16: 'Waypoint Navigation',
  201: 'Reposition',
  192: 'Reposition',
};

const NAV_STATE_NAMES: Record<number, { text: string; type: Message['type'] }> = {
  17: { text: 'Initiating Takeoff', type: 'info' },
  5: { text: 'Returning to Launch (RTL)', type: 'warn' },
  18: { text: 'Landing Sequence Active', type: 'info' },
};

export default function StatusMessageHub() {
  const { ros, connected } = useRos();
  const [activeMessages, setActiveMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<Message[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [lastArmingState, setLastArmingState] = useState<number | null>(null);
  const [lastNavState, setLastNavState] = useState<number | null>(null);

  const addMessage = useCallback((text: string, type: Message['type'], persistent = false) => {
    const id = Math.random().toString(36).substr(2, 9);
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const newMessage: Message = { id, text, type, persistent, timestamp };

    setActiveMessages(prev => {
      if (persistent && prev.some(m => m.text === text && m.persistent)) return prev;
      return [...prev, newMessage];
    });

    setHistory(prev => [newMessage, ...prev].slice(0, 50));

    if (!persistent) {
      setTimeout(() => {
        setActiveMessages(prev => prev.filter(m => m.id !== id));
      }, 5000);
    }
  }, []);

  const removeMessage = (id: string) => {
    setActiveMessages(prev => prev.filter(m => m.id !== id));
  };

  useEffect(() => {
    if (!ros || !connected) return;

    // 1. Vehicle Status (Arming, Failsafe, Nav State)
    const statusSub = new ROSLIB.Topic({
      ros,
      name: '/fmu/out/vehicle_status_v4',
      messageType: 'px4_msgs/msg/VehicleStatus',
    });

    statusSub.subscribe((msg: any) => {
      // Arming changes
      if (lastArmingState !== null && msg.arming_state !== lastArmingState) {
        if (msg.arming_state === 2) addMessage('VEHICLE ARMED', 'success');
        else if (msg.arming_state === 1) addMessage('VEHICLE DISARMED', 'info');
      }
      setLastArmingState(msg.arming_state);

      // Nav State changes
      if (lastNavState !== null && msg.nav_state !== lastNavState) {
        const stateInfo = NAV_STATE_NAMES[msg.nav_state];
        if (stateInfo) {
          addMessage(stateInfo.text, stateInfo.type);
        }
      }
      setLastNavState(msg.nav_state);

      // Failsafe
      if (msg.failsafe) {
        addMessage('CRITICAL: Failsafe Active', 'error', true);
      } else {
        setActiveMessages(prev => prev.filter(m => m.text !== 'CRITICAL: Failsafe Active'));
      }
    });

    // 2. Command Acknowledgements (Failures)
    const ackSub = new ROSLIB.Topic({
      ros,
      name: '/fmu/out/vehicle_command_ack_v1',
      messageType: 'px4_msgs/msg/VehicleCommandAck',
    });

    ackSub.subscribe((msg: any) => {
      if (msg.result !== 0) {
        const cmdName = COMMAND_NAMES[msg.command] ?? `Cmd ${msg.command}`;
        const resultName = COMMAND_RESULT[msg.result] ?? `Error ${msg.result}`;
        addMessage(`${cmdName} ${resultName}`, 'error');
      }
    });

    // 3. Mission Status (from our mission node)
    const missionSub = new ROSLIB.Topic({
      ros,
      name: '/mission/status_text',
      messageType: 'std_msgs/msg/String',
    });

    missionSub.subscribe((msg: any) => {
      let type: Message['type'] = 'info';
      if (msg.data.includes('Paused')) type = 'warn';
      if (msg.data.includes('Finished')) type = 'success';
      addMessage(msg.data, type);
    });

    return () => {
      statusSub.unsubscribe();
      ackSub.unsubscribe();
      missionSub.unsubscribe();
    };
  }, [ros, connected, lastArmingState, lastNavState, addMessage]);

  return (
    <>
      {/* Top Trigger Button */}
      <button
        onClick={() => setShowHistory(!showHistory)}
        className="fixed top-0 left-1/2 -translate-x-1/2 z-[110] pointer-events-auto bg-neutral-900/80 hover:bg-neutral-800 border-x border-b border-neutral-700/50 px-4 py-1.5 rounded-b-xl transition-all flex items-center gap-2 group shadow-lg backdrop-blur-md"
      >
        <div className={`w-1.5 h-1.5 rounded-full ${history.length > 0 && history[0].type === 'error' ? 'bg-red-500 animate-pulse' : 'bg-cyan-500'}`} />
        <span className="text-[10px] font-bold tracking-widest text-neutral-400 group-hover:text-neutral-200 uppercase">
          Status Log
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-300 ${showHistory ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Floating Active Messages */}
      <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none w-full max-w-lg">
        {activeMessages.map(m => (
          <div
            key={m.id}
            className={`pointer-events-auto px-4 py-2 rounded-lg border shadow-2xl backdrop-blur-md transition-all duration-300 transform animate-in slide-in-from-top-4 flex items-center gap-3 w-max ${
              m.type === 'error'
                ? 'bg-red-950/40 border-red-500/50 text-red-200'
                : m.type === 'warn'
                ? 'bg-amber-950/40 border-amber-500/50 text-amber-200'
                : m.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                : 'bg-neutral-900/60 border-neutral-700 text-neutral-200'
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${
              m.type === 'error' ? 'bg-red-500 animate-pulse' :
              m.type === 'warn' ? 'bg-amber-500' :
              m.type === 'success' ? 'bg-emerald-500' : 'bg-cyan-500'
            }`} />
            <span className="text-xs font-bold uppercase tracking-wider font-mono">{m.text}</span>
            {m.persistent && (
              <button onClick={() => removeMessage(m.id)} className="ml-2 hover:text-white">✕</button>
            )}
          </div>
        ))}
      </div>

      {/* Scrollable History Dialog */}
      <div
        className={`fixed top-12 left-1/2 -translate-x-1/2 z-[90] w-full max-w-md max-h-[40vh] overflow-hidden bg-neutral-900/95 backdrop-blur-2xl rounded-2xl border border-neutral-700/50 shadow-2xl transition-all duration-500 ease-in-out transform ${
          showHistory ? 'translate-y-0 opacity-100' : '-translate-y-10 opacity-0 pointer-events-none'
        } flex flex-col`}
      >
        <div className="px-4 py-3 border-b border-neutral-800 flex justify-between items-center bg-black/20">
          <h3 className="text-[10px] font-bold tracking-[0.2em] text-neutral-500 uppercase">Message History</h3>
          <button onClick={() => setHistory([])} className="text-[10px] text-neutral-600 hover:text-red-400 transition font-bold uppercase">Clear All</button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {history.length === 0 ? (
            <div className="py-8 text-center text-xs text-neutral-600 italic">No events logged yet</div>
          ) : (
            history.map(m => (
              <div
                key={m.id}
                className="group flex items-start gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors border border-transparent hover:border-neutral-800"
              >
                <span className="text-[9px] font-mono text-neutral-600 shrink-0 mt-0.5">{m.timestamp}</span>
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${
                  m.type === 'error' ? 'bg-red-500' :
                  m.type === 'warn' ? 'bg-amber-500' :
                  m.type === 'success' ? 'bg-emerald-500' : 'bg-cyan-500'
                }`} />
                <span className={`text-[11px] font-medium leading-relaxed ${
                  m.type === 'error' ? 'text-red-300' :
                  m.type === 'warn' ? 'text-amber-200' :
                  m.type === 'success' ? 'text-emerald-200' : 'text-neutral-300'
                }`}>
                  {m.text}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
