"use client";

import { createContext, useContext } from 'react';
import * as ROSLIB from 'roslib';

export type Waypoint = {
  id: string;
  lat: number;
  lon: number;
  alt: number;
};

export type LocalRef = {
  ref_lat: number;
  ref_lon: number;
  ref_alt: number;
} | null;

export type LocalPos = {
  x: number;
  y: number;
  z: number;
} | null;

export type WaypointStore = {
  waypoints: Waypoint[];
  executing: boolean;
  activeIndex: number;
  add: (lat: number, lon: number) => void;
  remove: (id: string) => void;
  setAltitude: (id: string, alt: number) => void;
  clear: () => void;
  accept: () => { ok: boolean; error?: string };
  cancel: () => { ok: boolean; error?: string };
};

export const WaypointContext = createContext<WaypointStore | null>(null);

export const useWaypoints = (): WaypointStore => {
  const ctx = useContext(WaypointContext);
  if (!ctx) throw new Error('useWaypoints must be used inside <WaypointProvider>');
  return ctx;
};

export const WP_TOL_M = 0.6;
export const DEFAULT_ALT_M = 5.0;

export function latLonToEnu(
  lat: number,
  lon: number,
  alt: number,
  ref: { ref_lat: number; ref_lon: number; ref_alt: number },
): { east: number; north: number; up: number } {
  const refLatRad = (ref.ref_lat * Math.PI) / 180;
  const dN = (lat - ref.ref_lat) * 110540;
  const dE = (lon - ref.ref_lon) * Math.cos(refLatRad) * 111320;
  return { east: dE, north: dN, up: alt - ref.ref_alt };
}

export function publishGoto(
  ros: ROSLIB.Ros,
  enu: { east: number; north: number; up: number },
) {
  const topic = new ROSLIB.Topic({
    ros,
    name: '/mission/goto',
    messageType: 'geometry_msgs/msg/PoseStamped',
  });
  const now = Date.now();
  const sec = Math.floor(now / 1000);
  const nanosec = (now % 1000) * 1_000_000;
  topic.publish({
    header: {
      stamp: { sec, nanosec },
      frame_id: 'map',
    },
    pose: {
      position: { x: enu.east, y: enu.north, z: enu.up },
      orientation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 },
    },
  } as any);
}
