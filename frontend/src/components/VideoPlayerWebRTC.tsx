'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as ROSLIB from 'roslib';
import { useRos } from './RosProvider';

type ConnectionStatus = 'idle' | 'fetching-config' | 'connecting' | 'connected' | 'failed' | 'closed';

interface Detection {
  bbox: [number, number, number, number];
  imgW: number;
  imgH: number;
  label: string;
  conf: number;
  ts: number;
}

const DETECTION_TTL_MS = 1000;

export default function VideoPlayerWebRTC({
  onToggleTheater,
  isTheater = false,
}: {
  onToggleTheater: () => void;
  isTheater?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectionRef = useRef<Detection | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [resolution, setResolution] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const { ros, connected: rosConnected } = useRos();

  const handleVideoMetadata = () => {
    if (videoRef.current) {
      setResolution(`${videoRef.current.videoHeight}p`);
    }
  };

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

  // Subscribe to /sar/detection_overlay and stash the latest detection.
  useEffect(() => {
    if (!ros || !rosConnected) return;
    const sub = new ROSLIB.Topic({
      ros,
      name: '/sar/detection_overlay',
      messageType: 'std_msgs/msg/String',
    });
    sub.subscribe(raw => {
      const m = raw as { data: string };
      try {
        const p = JSON.parse(m.data);
        detectionRef.current = {
          bbox: p.bbox,
          imgW: p.img_w,
          imgH: p.img_h,
          label: p.label,
          conf: p.conf,
          ts: p.ts,
        };
      } catch {
        // ignore
      }
    });
    return () => sub.unsubscribe();
  }, [ros, rosConnected]);

  // Repaint the bbox canvas on each animation frame; drop stale detections.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (canvas && video && video.videoWidth > 0) {
        if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
          canvas.width = video.clientWidth;
          canvas.height = video.clientHeight;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const det = detectionRef.current;
          const ageMs = det ? Date.now() - det.ts * 1000 : Infinity;
          if (det && ageMs < DETECTION_TTL_MS && det.imgW > 0 && det.imgH > 0) {
            const sx = canvas.width / det.imgW;
            const sy = canvas.height / det.imgH;
            const [x, y, w, h] = det.bbox;
            const opacity = Math.max(0, 1 - ageMs / DETECTION_TTL_MS);
            ctx.strokeStyle = `rgba(239, 68, 68, ${opacity})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(x * sx, y * sy, w * sx, h * sy);
            ctx.fillStyle = `rgba(239, 68, 68, ${opacity})`;
            ctx.font = '12px monospace';
            const label = `${det.label} ${(det.conf * 100).toFixed(0)}%`;
            const tw = ctx.measureText(label).width;
            ctx.fillRect(x * sx, y * sy - 16, tw + 8, 16);
            ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
            ctx.fillText(label, x * sx + 4, y * sy - 4);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

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
        onLoadedMetadata={handleVideoMetadata}
        className="w-full h-full object-cover"
      />

      {/* LIVE label */}
      <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded text-xs text-green-400 font-mono border border-green-500/30 z-10">
        LIVE | {resolution || 'WebRTC'}
      </div>

      {/* Detection overlay; sized to match the video element. */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
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

      {/* Theater Mode Toggle Button */}
      <button
        onClick={onToggleTheater}
        className="absolute bottom-3 right-3 p-2 bg-black/60 backdrop-blur-md rounded-lg border border-neutral-700 text-neutral-400 hover:text-white transition-all z-30"
        title={isTheater ? "Normal View" : "Enlarge Video"}
      >
        {isTheater ? (
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
  );
}

