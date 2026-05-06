"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';
import { useRos } from './RosProvider';
import {
  WaypointContext,
  Waypoint,
  WaypointStore,
  WP_TOL_M,
  DEFAULT_ALT_M,
  latLonToEnu,
  publishGoto,
} from '@/hooks/useWaypoints';

export const WaypointProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { ros, connected } = useRos();
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [executing, setExecuting] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const refRef = useRef<{ ref_lat: number; ref_lon: number; ref_alt: number } | null>(null);
  const targetEnuRef = useRef<{ east: number; north: number; up: number } | null>(null);
  const queueRef = useRef<Waypoint[]>([]);
  const indexRef = useRef(0);
  const advancingRef = useRef(false);
  const executingRef = useRef(false);
  const localPosRef = useRef<{ x: number; y: number; z: number } | null>(null);

  useEffect(() => {
    executingRef.current = executing;
  }, [executing]);

  useEffect(() => {
    if (!ros || !connected) return;
    const sub = new ROSLIB.Topic({
      ros,
      name: '/fmu/out/vehicle_local_position_v1',
      messageType: 'px4_msgs/msg/VehicleLocalPosition',
    });
    sub.subscribe((msg: any) => {
      if (msg.ref_lat !== 0 || msg.ref_lon !== 0) {
        refRef.current = {
          ref_lat: msg.ref_lat,
          ref_lon: msg.ref_lon,
          ref_alt: msg.ref_alt ?? 0,
        };
      }
      localPosRef.current = { x: msg.x, y: msg.y, z: msg.z };
      if (executingRef.current && targetEnuRef.current && !advancingRef.current) {
        const target = targetEnuRef.current;
        const dx = msg.y - target.east;
        const dy = msg.x - target.north;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= WP_TOL_M) {
          const next = indexRef.current + 1;
          if (next >= queueRef.current.length) {
            targetEnuRef.current = null;
            setExecuting(false);
          } else {
            advancingRef.current = true;
            indexRef.current = next;
            setActiveIndex(next);
            const wp = queueRef.current[next];
            const ref = refRef.current;
            if (ref && ros) {
              const enu = latLonToEnu(wp.lat, wp.lon, wp.alt, ref);
              targetEnuRef.current = enu;
              publishGoto(ros, enu);
            }
            setTimeout(() => {
              advancingRef.current = false;
            }, 200);
          }
        }
      }
    });
    return () => sub.unsubscribe();
  }, [ros, connected]);

  const add = useCallback((lat: number, lon: number) => {
    setWaypoints(prev => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        lat,
        lon,
        alt: DEFAULT_ALT_M,
      },
    ]);
  }, []);

  const remove = useCallback((id: string) => {
    setWaypoints(prev => prev.filter(w => w.id !== id));
  }, []);

  const setAltitude = useCallback((id: string, alt: number) => {
    setWaypoints(prev => prev.map(w => (w.id === id ? { ...w, alt } : w)));
  }, []);

  const clear = useCallback(() => setWaypoints([]), []);

  const accept = useCallback<WaypointStore['accept']>(() => {
    if (!ros) return { ok: false, error: 'ROS not connected' };
    if (waypoints.length === 0) return { ok: false, error: 'No waypoints to fly' };
    const ref = refRef.current;
    if (!ref) return { ok: false, error: 'Waiting for GPS reference from PX4' };
    queueRef.current = [...waypoints];
    indexRef.current = 0;
    const wp = queueRef.current[0];
    const enu = latLonToEnu(wp.lat, wp.lon, wp.alt, ref);
    targetEnuRef.current = enu;
    publishGoto(ros, enu);
    setExecuting(true);
    setActiveIndex(0);
    return { ok: true };
  }, [ros, waypoints]);

  const cancel = useCallback<WaypointStore['cancel']>(() => {
    if (!ros) return { ok: false, error: 'ROS not connected' };
    const cur = localPosRef.current;
    queueRef.current = [];
    indexRef.current = 0;
    setExecuting(false);
    setActiveIndex(0);
    if (!cur) {
      targetEnuRef.current = null;
      return { ok: true };
    }
    const enu = { east: cur.y, north: cur.x, up: -cur.z };
    targetEnuRef.current = enu;
    publishGoto(ros, enu);
    return { ok: true };
  }, [ros]);

  const value = useMemo<WaypointStore>(
    () => ({
      waypoints,
      executing,
      activeIndex,
      add,
      remove,
      setAltitude,
      clear,
      accept,
      cancel,
    }),
    [waypoints, executing, activeIndex, add, remove, setAltitude, clear, accept, cancel],
  );

  return <WaypointContext.Provider value={value}>{children}</WaypointContext.Provider>;
};
