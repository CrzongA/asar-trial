import React, { useEffect, useRef, useState } from 'react';

export default function VideoPlayerWebRTC() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<string>('Connecting...');

  useEffect(() => {
    let pc: RTCPeerConnection;

    const startWebRTC = async () => {
      pc = new RTCPeerConnection();

      pc.addEventListener('track', (evt) => {
        if (evt.track.kind === 'video' && videoRef.current) {
          videoRef.current.srcObject = evt.streams[0];
          setStatus('Connected');
        }
      });

      pc.addTransceiver('video', { direction: 'recvonly' });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      try {
        const response = await fetch(`http://${window.location.hostname}:8080/offer`, {
          body: JSON.stringify({
            sdp: pc.localDescription?.sdp,
            type: pc.localDescription?.type,
          }),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        });

        const answer = await response.json();
        await pc.setRemoteDescription(answer);
      } catch (err) {
        console.error('WebRTC Error:', err);
        setStatus('Connection Failed');
      }
    };

    startWebRTC();

    return () => {
      if (pc) pc.close();
    };
  }, []);

  return (
    <div className="w-full h-full bg-neutral-900 flex items-center justify-center relative">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
      {status !== 'Connected' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-500 bg-black/50">
          <svg className={`w-12 h-12 mb-3 ${status === 'Connecting...' ? 'animate-pulse text-cyan-600' : 'text-red-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          <span className="text-sm font-medium tracking-wider">{status.toUpperCase()}</span>
        </div>
      )}
    </div>
  );
}
