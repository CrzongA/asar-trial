import React from 'react';

export default function VideoPlayer() {
  return (
    <div className="w-full h-full bg-neutral-900 flex items-center justify-center">
      <div className="text-neutral-500 flex flex-col items-center">
        <svg className="w-12 h-12 mb-3 animate-pulse text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
        <span className="text-sm font-medium tracking-wider">AWAITING WEBRTC STREAM</span>
      </div>
    </div>
  );
}
