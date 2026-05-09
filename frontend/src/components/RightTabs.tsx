"use client";

import React, { useState } from 'react';
import SARMissionManager from './SARMissionManager';
import PX4Flags from './PX4Flags';
import TelemetryDashboard from './TelemetryDashboard';
import VLMConsole from './VLMConsole';

type Tab = 'sar' | 'telemetry' | 'vlm' | 'px4';

export default function RightTabs() {
  const [tab, setTab] = useState<Tab>('sar');

  return (
    <div className="bg-neutral-800/50 rounded-xl border border-neutral-700 shadow-lg flex flex-col h-full overflow-hidden">
      <div className="flex border-b border-neutral-700 shrink-0 overflow-x-auto scrollbar-hide">
        <TabButton active={tab === 'sar'} onClick={() => setTab('sar')}>
          SAR missions
        </TabButton>
        <TabButton active={tab === 'telemetry'} onClick={() => setTab('telemetry')}>
          Telemetry
        </TabButton>
        <TabButton active={tab === 'vlm'} onClick={() => setTab('vlm')}>
          Agent Log
        </TabButton>
        <TabButton active={tab === 'px4'} onClick={() => setTab('px4')} alert>
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
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm font-semibold transition border-b-2 ${
        active
          ? 'border-cyan-400 text-cyan-300 bg-neutral-800/80'
          : alert
          ? 'border-transparent text-amber-400/70 hover:text-amber-300 hover:bg-neutral-800/50'
          : 'border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
      }`}
    >
      {children}
    </button>
  );
}
