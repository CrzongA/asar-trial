"use client";

import React, { useEffect, useState } from "react";
import dynamic from 'next/dynamic';

const MissionMap = dynamic(() => import('@/components/MissionMap'), { ssr: false });
import VideoPlayer from '@/components/VideoPlayer';
import { RosProvider, useRos } from '@/components/RosProvider';
import TelemetryDashboard from '@/components/TelemetryDashboard';
import VLMConsole from '@/components/VLMConsole';

function HomeContent() {
  const { connected } = useRos();

  return (
    <main className="min-h-screen bg-neutral-900 text-white p-6 font-sans selection:bg-cyan-500 selection:text-white">
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-600">
            ASAR Control Center
          </h1>
          <p className="text-neutral-400 text-sm">Autonomous Search and Rescue</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 bg-neutral-800 rounded-full border border-neutral-700">
            <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
            <span className="text-sm font-medium text-neutral-300">
              {connected ? 'ROS 2 Connected' : 'Connecting...'}
            </span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-120px)]">
        {/* Main View: Video Stream */}
        <div className="col-span-1 lg:col-span-2 flex flex-col gap-6">
          <div className="flex-grow bg-black rounded-xl overflow-hidden border border-neutral-800 shadow-2xl relative group">
            <VideoPlayer />
            <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded text-xs text-green-400 font-mono border border-green-500/30">
              LIVE | 1080p 60fps | WebRTC
            </div>
          </div>
          
          <div className="h-64 rounded-xl overflow-hidden border border-neutral-800 shadow-lg relative">
             <MissionMap />
          </div>
        </div>

        {/* Sidebar: Telemetry and VLM Logs */}
        <div className="col-span-1 flex flex-col gap-6">
          <TelemetryDashboard />
          <VLMConsole />
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <RosProvider>
      <HomeContent />
    </RosProvider>
  );
}
