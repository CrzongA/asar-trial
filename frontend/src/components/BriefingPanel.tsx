'use client';

import React, { useEffect, useState } from 'react';
import * as ROSLIB from 'roslib';

import { useRos } from './RosProvider';

const EMPTY_IMAGE = {
  header: { stamp: { sec: 0, nanosec: 0 }, frame_id: '' },
  height: 0,
  width: 0,
  encoding: '',
  is_bigendian: 0,
  step: 0,
  data: [] as number[],
};

async function fileToImageMsg(file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas ctx unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  // RGBA -> RGB8
  const rgb = new Uint8Array(bitmap.width * bitmap.height * 3);
  for (let i = 0, j = 0; i < data.data.length; i += 4, j += 3) {
    rgb[j] = data.data[i];
    rgb[j + 1] = data.data[i + 1];
    rgb[j + 2] = data.data[i + 2];
  }
  // roslibjs expects bytes as a base64 string for uint8[] under rosbridge.
  let binary = '';
  for (let i = 0; i < rgb.length; i++) binary += String.fromCharCode(rgb[i]);
  const b64 = btoa(binary);
  return {
    header: { stamp: { sec: 0, nanosec: 0 }, frame_id: 'briefing' },
    height: bitmap.height,
    width: bitmap.width,
    encoding: 'rgb8',
    is_bigendian: 0,
    step: bitmap.width * 3,
    data: b64,
  };
}

export default function BriefingPanel() {
  const { ros, connected } = useRos();
  const [agentState, setAgentState] = useState('IDLE');
  const [target, setTarget] = useState('red cylinder');
  const [centerLat, setCenterLat] = useState('47.397971');
  const [centerLon, setCenterLon] = useState('8.546164');
  const [radius, setRadius] = useState('15');
  const [altitude, setAltitude] = useState('8');
  const [clueFile, setClueFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string>('');

  useEffect(() => {
    if (!ros || !connected) return;
    const sub = new ROSLIB.Topic({
      ros,
      name: '/sar/state',
      messageType: 'std_msgs/msg/String',
    });
    sub.subscribe(raw => setAgentState((raw as { data?: string })?.data ?? 'IDLE'));
    return () => sub.unsubscribe();
  }, [ros, connected]);

  const idle = agentState === 'IDLE' || agentState === 'SECURED' || agentState === 'ABORTED';

  const submit = async () => {
    if (!ros || !connected) {
      setFeedback('ROS not connected.');
      return;
    }
    setSubmitting(true);
    setFeedback('');
    try {
      const clueImage = clueFile ? await fileToImageMsg(clueFile) : EMPTY_IMAGE;
      const topic = new ROSLIB.Topic({
        ros,
        name: '/sar/briefing',
        messageType: 'asar_msgs/msg/MissionBriefing',
      });
      topic.publish({
        target_description: target,
        clue_image: clueImage,
        search_center_lat: parseFloat(centerLat),
        search_center_lon: parseFloat(centerLon),
        search_radius_m: parseFloat(radius),
        search_altitude_m: parseFloat(altitude),
      });
      setFeedback('Briefing published.');
    } catch (err) {
      setFeedback(`Publish failed: ${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto">
      <div className="flex justify-between items-center">
        <h2 className="text-base font-semibold text-cyan-400">Mission Briefing</h2>
        <span className="text-[10px] uppercase text-neutral-500">/sar/briefing</span>
      </div>

      {!idle && (
        <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded p-2">
          Agent is {agentState}. Cancel or wait for SECURED before launching a new briefing.
        </div>
      )}

      <label className="block text-xs text-neutral-400">
        Target description
        <input
          className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm text-white"
          value={target}
          onChange={e => setTarget(e.target.value)}
          placeholder='e.g. "person wearing a red jacket"'
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-neutral-400">
          Center lat
          <input
            className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm text-white font-mono"
            value={centerLat}
            onChange={e => setCenterLat(e.target.value)}
          />
        </label>
        <label className="block text-xs text-neutral-400">
          Center lon
          <input
            className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm text-white font-mono"
            value={centerLon}
            onChange={e => setCenterLon(e.target.value)}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-neutral-400">
          Radius (m)
          <input
            type="number"
            className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm text-white font-mono"
            value={radius}
            onChange={e => setRadius(e.target.value)}
          />
        </label>
        <label className="block text-xs text-neutral-400">
          Altitude (m)
          <input
            type="number"
            className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm text-white font-mono"
            value={altitude}
            onChange={e => setAltitude(e.target.value)}
          />
        </label>
      </div>

      <label className="block text-xs text-neutral-400">
        Optional clue image
        <input
          type="file"
          accept="image/*"
          onChange={e => setClueFile(e.target.files?.[0] ?? null)}
          className="mt-1 w-full text-xs text-neutral-300 file:mr-2 file:px-2 file:py-1 file:rounded file:border-0 file:bg-neutral-700 file:text-white"
        />
      </label>

      <button
        onClick={submit}
        disabled={!idle || submitting}
        className="px-3 py-2 rounded bg-cyan-600 hover:bg-cyan-500 disabled:bg-neutral-700 disabled:text-neutral-400 text-white text-sm font-semibold transition"
      >
        {submitting ? 'Publishing...' : 'Launch Mission'}
      </button>

      {feedback && (
        <p className="text-xs text-neutral-400">{feedback}</p>
      )}
    </div>
  );
}
