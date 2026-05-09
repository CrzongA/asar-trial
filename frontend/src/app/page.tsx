"use client";

import React, { useState, useEffect } from "react";
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
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [theaterMode, setTheaterMode] = useState(false);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullScreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

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
          
          {/* Full Screen Button */}
          <button
            onClick={toggleFullScreen}
            className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg border border-neutral-700 text-neutral-400 hover:text-white transition-colors"
            title={isFullScreen ? "Exit Full Screen" : "Enter Full Screen"}
          >
            {isFullScreen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col gap-3 p-3 relative">
        <div className={`flex-1 min-h-0 grid gap-3 transition-all duration-500 ${theaterMode ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-5'}`}>
          {/* Video Feed Container */}
          <div className={`bg-black rounded-xl overflow-hidden border border-neutral-800 shadow-2xl relative transition-all duration-500 ${theaterMode ? 'col-span-1 h-full' : 'col-span-1 lg:col-span-3'}`}>
            <VideoPlayerWebRTC onToggleTheater={() => setTheaterMode(!theaterMode)} isTheater={theaterMode} />
            
            {/* Shrunken Map Overlay (Only in theater mode) */}
            <div className={`absolute top-3 right-3 w-80 h-60 rounded-xl overflow-hidden border border-neutral-700 shadow-2xl z-20 hover:scale-105 transition-all duration-500 ${theaterMode ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
               <MissionMap isMini={theaterMode} />
            </div>
          </div>

          {/* Normal Mode Map Container */}
          <div className={`rounded-xl overflow-hidden border border-neutral-800 shadow-lg relative transition-all duration-500 ${theaterMode ? 'hidden' : 'col-span-1 lg:col-span-2'}`}>
            <MissionMap />
          </div>
        </div>

        {/* Bottom Section: Telemetry Tabs */}
        <div className={`flex-1 min-h-0 flex justify-center transition-all duration-500 ${theaterMode ? 'hidden' : ''}`}>
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

