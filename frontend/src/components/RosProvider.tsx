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
    const rosInstance = new ROSLIB.Ros({
      url: 'ws://localhost:9090'
    });

    rosInstance.on('connection', () => {
      console.log('Connected to websocket server.');
      setConnected(true);
    });

    rosInstance.on('error', (error: any) => {
      console.log('Error connecting to websocket server: ', error);
      setConnected(false);
    });

    rosInstance.on('close', () => {
      console.log('Connection to websocket server closed.');
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
