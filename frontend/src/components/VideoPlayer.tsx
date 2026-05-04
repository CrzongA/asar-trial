import React, { useState, useEffect } from 'react';

export default function VideoPlayer() {
  const [streamUrl, setStreamUrl] = useState<string>('');

  useEffect(() => {
    // Next.js development proxies often buffer or kill multipart/x-mixed-replace streams.
    // Instead, we poll the /api/snapshot endpoint at 15 FPS (every ~66ms).
    // The timestamp cache-buster forces the browser to fetch the new frame.
    const interval = setInterval(() => {
      setStreamUrl(`/api/snapshot?t=${Date.now()}`);
    }, 66);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full h-full bg-neutral-900 flex items-center justify-center relative overflow-hidden">
      {streamUrl ? (
        <img 
          src={streamUrl} 
          alt="Live Camera Feed"
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
            document.getElementById('mjpeg-error')?.classList.remove('hidden');
          }}
          onLoad={(e) => {
            (e.target as HTMLImageElement).style.display = 'block';
            document.getElementById('mjpeg-error')?.classList.add('hidden');
          }}
        />
      ) : null}
      
      <div id="mjpeg-error" className="absolute inset-0 flex flex-col items-center justify-center text-neutral-500 bg-black/50 hidden">
        <svg className="w-12 h-12 mb-3 animate-pulse text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
        <span className="text-sm font-medium tracking-wider">CONNECTION FAILED</span>
      </div>
    </div>
  );
}

