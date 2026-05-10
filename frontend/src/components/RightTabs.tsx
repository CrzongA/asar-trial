"use client";

import React, { useState, useEffect } from 'react';
import * as ROSLIB from 'roslib';
import { useRos } from './RosProvider';
import SARMissionManager from './SARMissionManager';
import PX4Flags from './PX4Flags';
import TelemetryDashboard from './TelemetryDashboard';
import VLMConsole from './VLMConsole';

type Tab = 'sar' | 'telemetry' | 'vlm' | 'px4';

export default function RightTabs() {
  const { ros, connected } = useRos();
  const [tab, setTab] = useState<Tab>('sar');
  const [hasNewLogs, setHasNewLogs] = useState(false);

  useEffect(() => {
    if (!ros || !connected) return;

    const sub = new ROSLIB.Topic({
      ros,
      name: '/sar/agent_log',
      messageType: 'std_msgs/msg/String',
    });

    sub.subscribe(() => {
      setHasNewLogs(prev => {
        if (tab !== 'vlm') return true;
        return prev;
      });
    });

    return () => sub.unsubscribe();
  }, [ros, connected, tab]);

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    if (newTab === 'vlm') {
      setHasNewLogs(false);
    }
  };

  return (
    <div className="bg-neutral-800/50 rounded-xl border border-neutral-700 shadow-lg flex flex-col h-full overflow-hidden">
      <div className="flex border-b border-neutral-700 shrink-0 overflow-x-auto scrollbar-hide">
        <TabButton active={tab === 'sar'} onClick={() => handleTabChange('sar')}>
          SAR missions
        </TabButton>
        <TabButton active={tab === 'telemetry'} onClick={() => handleTabChange('telemetry')}>
          Telemetry
        </TabButton>
        <TabButton 
          active={tab === 'vlm'} 
          onClick={() => handleTabChange('vlm')}
          notification={hasNewLogs}
        >
          Agent Log
        </TabButton>
        <TabButton active={tab === 'px4'} onClick={() => handleTabChange('px4')} alert>
          PX4 Flags
        </TabButton>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <div className={`flex-1 min-h-0 flex flex-col ${tab === 'sar' ? '' : 'hidden'}`}>
          <SARMissionManager />
        </div>
        <div className={`flex-1 min-h-0 flex flex-col ${tab === 'telemetry' ? '' : 'hidden'}`}>
          <TelemetryDashboard />
        </div>
        <div className={`flex-1 min-h-0 flex flex-col ${tab === 'vlm' ? '' : 'hidden'}`}>
          <VLMConsole />
        </div>
        <div className={`flex-1 min-h-0 flex flex-col ${tab === 'px4' ? '' : 'hidden'}`}>
          <PX4Flags />
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  alert,
  notification,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  alert?: boolean;
  notification?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative px-3 py-2 text-sm font-semibold transition border-b-2 ${
        active
          ? 'border-cyan-400 text-cyan-300 bg-neutral-800/80'
          : alert
          ? 'border-transparent text-amber-400/70 hover:text-amber-300 hover:bg-neutral-800/50'
          : 'border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
      }`}
    >
      <div className="flex items-center gap-1.5">
        {children}
        {notification && (
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
          </span>
        )}
      </div>
    </button>
  );
}

