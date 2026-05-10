'use client';

import React, { useEffect, useState, useMemo } from 'react';
import * as ROSLIB from 'roslib';
import { useRos } from './RosProvider';
import BriefingPanel from './BriefingPanel';
import TargetStatusCard from './TargetStatusCard';

export interface Mission {
  id: string;
  targetDescription: string;
  centerLat: number;
  centerLon: number;
  radius: number;
  altitude: number;
  creationTime: number;
  status: 'active' | 'success' | 'failed' | 'aborted';
  result?: any; // TargetStatus
}

type View = 'list' | 'create' | 'details';

export default function SARMissionManager() {
  const { ros, connected } = useRos();
  const [view, setView] = useState<View>('list');
  const [missions, setMissions] = useState<Mission[]>([]);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [agentState, setAgentState] = useState('IDLE');

  // Load missions from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('sar_missions');
    if (saved) {
      try {
        setMissions(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved missions', e);
      }
    }
  }, []);

  // Save missions to localStorage on change
  useEffect(() => {
    localStorage.setItem('sar_missions', JSON.stringify(missions));
  }, [missions]);

  // Subscribe to agent state
  useEffect(() => {
    if (!ros || !connected) return;
    const sub = new ROSLIB.Topic({
      ros,
      name: '/sar/state',
      messageType: 'std_msgs/msg/String',
    });
    sub.subscribe((raw: any) => {
      const newState = raw?.data ?? 'IDLE';
      setAgentState(newState);

      // Update active mission status if it completes
      setMissions(prev => {
        const activeIdx = prev.findIndex(m => m.status === 'active');
        if (activeIdx === -1) return prev;

        const activeMission = prev[activeIdx];
        let updatedStatus = activeMission.status;

        if (newState === 'SECURED') {
          updatedStatus = 'success';
        } else if (newState === 'ABORTED') {
          updatedStatus = 'aborted';
        } else if (newState === 'IDLE' && activeMission.status === 'active') {
          // If it goes back to IDLE without SECURED/ABORTED, might be a reset or completion without detection
          // We'll leave it as success for now if it was active, or maybe 'failed' if no target found.
          // For simplicity, let's just track SECURED and ABORTED specifically.
        }

        if (updatedStatus !== activeMission.status) {
          const next = [...prev];
          next[activeIdx] = { ...activeMission, status: updatedStatus };
          return next;
        }
        return prev;
      });
    });
    return () => sub.unsubscribe();
  }, [ros, connected]);

  // Subscribe to target status to capture results
  useEffect(() => {
    if (!ros || !connected) return;
    const sub = new ROSLIB.Topic({
      ros,
      name: '/mission/target_status',
      messageType: 'asar_msgs/msg/TargetStatus',
    });
    sub.subscribe((msg: any) => {
      if (msg.found) {
        setMissions(prev => {
          const activeIdx = prev.findIndex(m => m.status === 'active');
          if (activeIdx === -1) return prev;

          const next = [...prev];
          next[activeIdx] = {
            ...next[activeIdx],
            result: {
              found: msg.found,
              missionId: msg.mission_id,
              health: msg.health,
              terrain: msg.terrain,
              distanceToSafetyM: msg.distance_to_safety_m,
              latitude: msg.latitude,
              longitude: msg.longitude,
              altitudeM: msg.altitude_m,
              confidence: msg.confidence,
              rationale: msg.vlm_rationale,
            }
          };
          return next;
        });
      }
    });
    return () => sub.unsubscribe();
  }, [ros, connected]);

  const handleLaunch = (missionDetails: Omit<Mission, 'id' | 'creationTime' | 'status'>) => {
    const newMission: Mission = {
      ...missionDetails,
      id: Math.random().toString(36).substring(2, 15) + Date.now().toString(36),
      creationTime: Date.now(),
      status: 'active',
    };
    setMissions(prev => [newMission, ...prev]);
    setView('list');
  };

  const publishControl = (cmd: string) => {
    if (!ros || !connected) return;
    const topic = new ROSLIB.Topic({
      ros,
      name: '/sar/control',
      messageType: 'std_msgs/msg/String',
    });
    topic.publish({ data: cmd });
  };

  const handleDelete = (id: string) => {
    setMissions(prev => prev.filter(m => m.id !== id));
  };

  const sortedMissions = useMemo(() => {
    return [...missions].sort((a, b) => b.creationTime - a.creationTime);
  }, [missions]);

  const selectedMission = useMemo(() => {
    return missions.find(m => m.id === selectedMissionId);
  }, [missions, selectedMissionId]);

  if (view === 'create') {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-3 flex items-center gap-2">
          <button
            onClick={() => setView('list')}
            className="p-1 hover:bg-neutral-800 rounded transition text-neutral-400 hover:text-white"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">New Mission</h2>
        </div>
        <BriefingPanel onMissionLaunched={handleLaunch} />
      </div>
    );
  }

  if (view === 'details' && selectedMission) {
    return (
      <div className="flex-1 flex flex-col min-h-0 p-4 overflow-y-auto">
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setView('list')}
            className="p-1 hover:bg-neutral-800 rounded transition text-neutral-400 hover:text-white"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">Mission Results</h2>
        </div>

        <div className="mb-4 p-3 bg-neutral-900/50 border border-neutral-800 rounded-lg">
          <h3 className="text-xs font-bold text-neutral-400 uppercase mb-2">Briefing</h3>
          <p className="text-sm text-white mb-2">{selectedMission.targetDescription}</p>
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-neutral-500">
            <div>Center: {selectedMission.centerLat.toFixed(6)}, {selectedMission.centerLon.toFixed(6)}</div>
            <div>Radius: {selectedMission.radius}m</div>
          </div>
        </div>

        <TargetStatusCard data={selectedMission.result} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-3 flex justify-between items-center border-b border-neutral-800/50">
        <h2 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">Mission History</h2>
        <button
          onClick={() => setView('create')}
          className="flex items-center gap-1.5 p-1.5 bg-cyan-600/20 hover:bg-cyan-600/40 border border-cyan-500/30 rounded-lg text-cyan-400 transition-all hover:scale-105 active:scale-95"
          title="Create New Mission"
        >
          <span className="text-xs font-mono">CREATE MISSION</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 pb-24 space-y-2">
        {sortedMissions.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-neutral-600 py-10">
            <svg className="mb-2 opacity-20" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs italic">No missions recorded</p>
          </div>
        ) : (
          sortedMissions.map(mission => {
            const isActive = mission.status === 'active';
            const isSuccess = mission.status === 'success';
            const isFailed = mission.status === 'failed' || mission.status === 'aborted';

            return (
              <div
                key={mission.id}
                className={`group relative rounded-xl border transition-all duration-300 ${isActive
                  ? 'bg-cyan-950/20 border-cyan-500/50 shadow-[0_0_15px_-5px_rgba(6,182,212,0.3)]'
                  : isSuccess
                    ? 'bg-green-950/10 border-green-500/30 hover:border-green-500/50'
                    : isFailed
                      ? 'bg-red-950/10 border-red-500/30 hover:border-red-500/50'
                      : 'bg-neutral-900/50 border-neutral-800 hover:border-neutral-700'
                  }`}
              >
                <div className="p-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className={`text-sm font-bold truncate ${isActive ? 'text-cyan-300' : 'text-neutral-200'}`}>
                        {mission.targetDescription}
                      </h3>
                      {isActive && (
                        <span className="flex h-2 w-2 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-neutral-500 font-medium">
                      <span>{new Date(mission.creationTime).toLocaleString()}</span>
                      <span className="font-mono">{mission.centerLat.toFixed(4)}, {mission.centerLon.toFixed(4)}</span>
                    </div>

                    {isActive && (
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => publishControl(agentState === 'PAUSED' ? 'resume' : 'pause')}
                          className={`px-3 py-1 rounded-md border text-[11px] font-bold transition-all ${agentState === 'PAUSED'
                            ? 'bg-amber-500 text-black border-amber-400 hover:bg-amber-400'
                            : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:bg-neutral-700'
                            }`}
                        >
                          {agentState === 'PAUSED' ? 'RESUME' : 'PAUSE'}
                        </button>
                        <button
                          onClick={() => publishControl('abort')}
                          className="px-3 py-1 rounded-md bg-red-600 text-white border border-red-500 text-[11px] font-bold hover:bg-red-500 transition-all"
                        >
                          ABORT
                        </button>
                      </div>
                    )}
                  </div>

                  {!isActive && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(mission.id)}
                        className="p-2 text-neutral-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                        title="Delete Mission"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        </svg>
                      </button>
                      <button
                        onClick={() => {
                          setSelectedMissionId(mission.id);
                          setView('details');
                        }}
                        className={`p-2 rounded-lg transition-all ${isSuccess ? 'text-green-500 hover:bg-green-500/20' : isFailed ? 'text-red-500 hover:bg-red-500/20' : 'text-neutral-600 hover:bg-neutral-800'
                          }`}
                        title="View Details"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

