"use client";

import React from "react";
import dynamic from 'next/dynamic';

import VideoPlayerWebRTC from '@/components/VideoPlayerWebRTC';
import { RosProvider, useRos } from '@/components/RosProvider';
import { WaypointProvider } from '@/components/WaypointProvider';
import RightTabs from '@/components/RightTabs';
import ActionBar from '@/components/ActionBar';
import ManualControlPanel from '@/components/ManualControlPanel';
import SARStatusBadge from '@/components/SARStatusBadge';
import StatusMessageHub from '@/components/StatusMessageHub';

const MissionMap = dynamic(() => import('@/components/MissionMap'), { ssr: false });

function HomeContent() {
  const { connected } = useRos();

  return (
    <main className="h-screen overflow-hidden bg-neutral-900 text-white font-sans selection:bg-cyan-500 selection:text-white flex flex-col">
      <header className="flex justify-between items-center px-6 py-3 border-b border-neutral-800 shrink-0">
        <div className="flex items-baseline gap-4">
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-600">
            ASAR Control Center
          </h1>
          <p className="text-neutral-500 text-xs">Autonomous Search and Rescue</p>
        </div>
        <div className="flex items-center gap-3">
          <ActionBar />
          <SARStatusBadge />
          <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-800 rounded-full border border-neutral-700">
            <div className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-xs font-medium text-neutral-300">
              {connected ? 'ROS 2 Connected' : 'Connecting...'}
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col gap-3 p-3 relative">
        {/* Top Section: Video & Map (1/2 Height) */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-5 gap-3">
          <div className="col-span-1 lg:col-span-3 bg-black rounded-xl overflow-hidden border border-neutral-800 shadow-2xl relative">
            <VideoPlayerWebRTC />
            <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded text-xs text-green-400 font-mono border border-green-500/30">
              LIVE | WebRTC
            </div>
          </div>
          <div className="col-span-1 lg:col-span-2 rounded-xl overflow-hidden border border-neutral-800 shadow-lg relative">
            <MissionMap />
          </div>
        </div>

        {/* Bottom Section: Tabs (1/2 Height, Middle Part) */}
        <div className="flex-1 min-h-0 flex justify-center">
          <div className="w-[65vw] max-w-6xl min-w-[500px]">
            <RightTabs />
          </div>
        </div>

        {/* Manual Control Overlay (Fixed positioning inside) */}
        <ManualControlPanel />

        {/* Aircraft Status Overlay */}
        <StatusMessageHub />
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <RosProvider>
      <WaypointProvider>
        <HomeContent />
      </WaypointProvider>
    </RosProvider>
  );
}
