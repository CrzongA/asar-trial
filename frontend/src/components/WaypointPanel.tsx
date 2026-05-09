"use client";

import React, { useState } from 'react';
import { useWaypoints } from '@/hooks/useWaypoints';

export default function WaypointPanel() {
  const { waypoints, executing, activeIndex, remove, setAltitude, accept, cancel, clear } =
    useWaypoints();
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleAccept = () => {
    const r = accept();
    if (!r.ok) setError(r.error ?? 'Failed to accept mission');
    else setError(null);
  };

  const handleCancel = () => {
    const r = cancel();
    if (!r.ok) setError(r.error ?? 'Failed to cancel mission');
    else setError(null);
  };

  if (isCollapsed) {
    return (
      <div className="absolute top-2 right-2 z-[400] bg-black/85 backdrop-blur-md rounded-lg border border-neutral-700 shadow-2xl overflow-hidden transition-all duration-300">
        <button 
          onClick={() => setIsCollapsed(false)}
          className="px-3 py-2 flex items-center gap-3 hover:bg-neutral-800/50 transition-colors"
          title="Expand Waypoints"
        >
          {waypoints.length === 0 ? (
            <>
              <span className="text-[10px] font-bold text-neutral-300 uppercase tracking-wider">Waypoints</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-500">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </>
          ) : (
            <div className="flex gap-1.5 overflow-x-auto max-w-[200px] no-scrollbar">
              {waypoints.map((w, i) => (
                <div
                  key={w.id}
                  className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold border transition-colors ${
                    executing && i === activeIndex
                      ? 'bg-emerald-600/40 text-emerald-300 border-emerald-500/50 animate-pulse'
                      : executing && i < activeIndex
                      ? 'bg-neutral-700/50 text-neutral-500 border-neutral-600/50'
                      : 'bg-cyan-600/20 text-cyan-400 border-cyan-500/30'
                  }`}
                >
                  {i + 1}
                </div>
              ))}
            </div>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="absolute top-2 right-2 z-[400] w-72 bg-black/85 backdrop-blur-md rounded-lg border border-neutral-700 shadow-2xl flex flex-col max-h-[calc(100%-1rem)] transition-all duration-300">
      <div className="px-3 py-2 border-b border-neutral-800 flex justify-between items-center shrink-0">
        <h3 className="text-xs font-bold text-neutral-200 uppercase">Waypoints</h3>
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded ${
              executing
                ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
                : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
            }`}
          >
            {executing ? `EXEC ${activeIndex + 1}/${waypoints.length}` : 'DRAFT'}
          </span>
          <button 
            onClick={() => setIsCollapsed(true)}
            className="p-1 hover:bg-neutral-800 rounded text-neutral-500 hover:text-neutral-300 transition-colors"
            title="Collapse"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 min-h-0">
        {waypoints.length === 0 ? (
          <div className="text-xs text-neutral-500 text-center py-3">
            Click on the map to add waypoints
          </div>
        ) : (
          waypoints.map((w, i) => (
            <div
              key={w.id}
              className={`flex items-center gap-2 px-2 py-1 rounded text-xs font-mono ${
                executing && i === activeIndex
                  ? 'bg-emerald-900/40 border border-emerald-600/40'
                  : 'bg-neutral-900 border border-neutral-800'
              }`}
            >
              <span className="text-cyan-400 w-5">{i + 1}</span>
              <span className="text-neutral-300 flex-1 truncate" title={`${w.lat}, ${w.lon}`}>
                {w.lat.toFixed(5)}, {w.lon.toFixed(5)}
              </span>
              <input
                type="number"
                step="0.5"
                value={w.alt}
                onChange={e => setAltitude(w.id, parseFloat(e.target.value) || 0)}
                disabled={executing}
                className="w-12 bg-neutral-800 border border-neutral-700 rounded px-1 text-xs disabled:opacity-50"
              />
              <span className="text-neutral-500">m</span>
              <button
                onClick={() => remove(w.id)}
                disabled={executing}
                className="text-red-400 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {error && (
        <div className="px-3 py-1 text-[10px] text-red-400 border-t border-red-900/40">
          {error}
        </div>
      )}

      <div className="px-2 py-2 border-t border-neutral-800 flex gap-1 shrink-0">
        <button
          onClick={handleAccept}
          disabled={executing || waypoints.length === 0}
          className="flex-1 px-2 py-1.5 rounded text-xs font-semibold bg-emerald-600/20 border border-emerald-500 text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ACCEPT
        </button>
        <button
          onClick={handleCancel}
          disabled={!executing}
          className="flex-1 px-2 py-1.5 rounded text-xs font-semibold bg-amber-600/20 border border-amber-500 text-amber-300 hover:bg-amber-600/30 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          CANCEL
        </button>
        <button
          onClick={clear}
          disabled={executing || waypoints.length === 0}
          className="px-2 py-1.5 rounded text-xs font-semibold bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          CLR
        </button>
      </div>
    </div>
  );
}
