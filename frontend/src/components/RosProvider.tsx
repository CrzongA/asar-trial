"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import * as ROSLIB from 'roslib';

interface RosContextType {
  ros: ROSLIB.Ros | null;
  connected: boolean;
}

const RosContext = createContext<RosContextType>({ ros: null, connected: false });

export const useRos = () => useContext(RosContext);

export const RosProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ros, setRos] = useState<ROSLIB.Ros | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const host =
      typeof window !== 'undefined' && window.location.hostname
        ? window.location.hostname
        : 'localhost';
    const port = process.env.NEXT_PUBLIC_ROSBRIDGE_PORT ?? '9090';
    const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = process.env.NEXT_PUBLIC_ROSBRIDGE_URL ?? `${proto}://${host}:${port}`;

    console.log('[ROS] connecting to', url);
    const rosInstance = new ROSLIB.Ros({ url });

    rosInstance.on('connection', () => {
      console.log('[ROS] connection open');
      setConnected(true);
    });

    rosInstance.on('error', (error: any) => {
      console.warn('[ROS] error', error);
      setConnected(false);
    });

    rosInstance.on('close', () => {
      console.log('[ROS] connection closed');
      setConnected(false);
    });

    setRos(rosInstance);

    return () => {
      rosInstance.close();
    };
  }, []);

  return (
    <RosContext.Provider value={{ ros, connected }}>
      {children}
    </RosContext.Provider>
  );
};
