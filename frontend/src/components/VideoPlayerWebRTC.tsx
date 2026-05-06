'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

type ConnectionStatus = 'idle' | 'fetching-config' | 'connecting' | 'connected' | 'failed' | 'closed';

export default function VideoPlayerWebRTC() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const start = useCallback(async () => {
    // Clean up any previous connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    setStatus('fetching-config');
    setErrorMsg('');

    // -----------------------------------------------------------------
    // 1. Fetch ICE server config from the server.
    //    This allows STUN/TURN credentials to live in server env vars
    //    and never be baked into the frontend bundle.
    // -----------------------------------------------------------------
    let iceServers: RTCIceServer[] = [];
    try {
      const cfgResp = await fetch('/api/config');
      if (cfgResp.ok) {
        const cfg = await cfgResp.json();
        iceServers = cfg.iceServers ?? [];
      }
    } catch {
      // If /config is unreachable, fall back to Google STUN so at least
      // internet-reachable srflx candidates are attempted.
      iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }

    setStatus('connecting');

    // -----------------------------------------------------------------
    // 2. Create peer connection with the server-provided ICE config.
    // -----------------------------------------------------------------
    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;

    pc.addEventListener('connectionstatechange', () => {
      const s = pc.connectionState;
      if (s === 'connected') setStatus('connected');
      else if (s === 'failed' || s === 'closed') {
        setStatus(s);
        setErrorMsg(`WebRTC connection ${s}. Check STUN/TURN reachability.`);
      }
    });

    pc.addEventListener('track', (evt) => {
      if (evt.track.kind === 'video' && videoRef.current) {
        videoRef.current.srcObject = evt.streams[0];
      }
    });

    // Receive-only — we only want video from the server, never send any.
    pc.addTransceiver('video', { direction: 'recvonly' });

    // -----------------------------------------------------------------
    // 3. Create offer and wait for ICE gathering to complete.
    //
    //    gather-then-send: we do NOT send the SDP until iceGatheringState
    //    is 'complete'. This ensures the offer contains real a=candidate
    //    lines (including srflx candidates from STUN) so the server can
    //    reach us. Without this wait, the offer may have no candidates,
    //    causing the connection to fail silently.
    // -----------------------------------------------------------------
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('ICE gathering timed out')),
        8000,
      );

      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        resolve();
        return;
      }

      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // -----------------------------------------------------------------
    // 4. Send the fully-gathered offer SDP to the server.
    // -----------------------------------------------------------------
    try {
      const resp = await fetch('/api/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: pc.localDescription?.sdp,
          type: pc.localDescription?.type,
        }),
      });

      if (!resp.ok) throw new Error(`Signaling server returned ${resp.status}`);

      const answer = await resp.json();
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      setStatus('failed');
      setErrorMsg(String(err));
    }
  }, []);

  useEffect(() => {
    start();
    return () => {
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [start]);

  const isConnected = status === 'connected';
  const isFailed = status === 'failed' || status === 'closed';

  return (
    <div className="w-full h-full bg-neutral-900 flex items-center justify-center relative overflow-hidden">
      {/* Video element — always mounted so srcObject can be set */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />

      {/* Overlay shown while not yet connected */}
      {!isConnected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 gap-3">
          <svg
            className={`w-12 h-12 ${isFailed ? 'text-red-500' : 'text-cyan-500 animate-pulse'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>

          <span className="text-sm font-mono tracking-widest text-neutral-300 uppercase">
            {status === 'fetching-config' && 'Fetching ICE config…'}
            {status === 'connecting' && 'Negotiating WebRTC…'}
            {status === 'failed' && 'Connection Failed'}
            {status === 'closed' && 'Connection Closed'}
            {status === 'idle' && 'Initialising…'}
          </span>

          {errorMsg && (
            <span className="text-xs text-red-400 max-w-xs text-center px-4">
              {errorMsg}
            </span>
          )}

          {isFailed && (
            <button
              onClick={start}
              className="mt-2 px-4 py-1.5 text-xs font-semibold rounded-full bg-cyan-600 hover:bg-cyan-500 text-white transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
