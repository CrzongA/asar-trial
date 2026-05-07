"use client";

import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const droneIcon = (heading: number) =>
  new L.DivIcon({
    className: 'drone-marker',
    html: `<div style="transform: rotate(${heading}deg); transition: transform 0.1s linear; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3L4 19L12 15L20 19L12 3Z" fill="#06b6d4" stroke="white" stroke-width="2" stroke-linejoin="round"/>
      </svg>
    </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

const waypointIcon = (idx: number, active: boolean) =>
  new L.DivIcon({
    className: 'waypoint-marker',
    html: `<div style="width:24px;height:24px;border-radius:50%;background:${
      active ? '#10b981' : '#f59e0b'
    };color:white;font-weight:bold;font-size:11px;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.5)">${idx}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

import { useRos } from './RosProvider';
import * as ROSLIB from 'roslib';
import { useWaypoints } from '@/hooks/useWaypoints';
import WaypointPanel from './WaypointPanel';

function MapClickHandler({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click: e => onClick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

export default function MissionMap() {
  const { ros, connected } = useRos();
  const { waypoints, activeIndex, executing, add } = useWaypoints();
  const [mounted, setMounted] = useState(false);
  const [dronePosition, setDronePosition] = useState<[number, number]>([47.397742, 8.545594]);
  const [heading, setHeading] = useState(0);
  const [haveFix, setHaveFix] = useState(false);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!ros || !connected) return;

    const gpsSub = new ROSLIB.Topic({
      ros,
      name: '/fmu/out/vehicle_global_position',
      messageType: 'px4_msgs/msg/VehicleGlobalPosition',
    });

    const posSub = new ROSLIB.Topic({
      ros,
      name: '/fmu/out/vehicle_local_position_v1',
      messageType: 'px4_msgs/msg/VehicleLocalPosition',
    });

    gpsSub.subscribe((msg: any) => {
      const lat = msg.lat;
      const lon = msg.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      setDronePosition([lat, lon]);
      if (!haveFix) {
        setHaveFix(true);
        if (mapRef.current) {
          mapRef.current.setView([lat, lon], mapRef.current.getZoom());
        }
      }
    });

    posSub.subscribe((msg: any) => {
      if (Number.isFinite(msg.heading)) {
        // msg.heading is in radians (NED), convert to degrees
        setHeading((msg.heading * 180) / Math.PI);
      }
    });

    return () => {
      gpsSub.unsubscribe();
      posSub.unsubscribe();
    };
  }, [ros, connected, haveFix]);

  if (!mounted) {
    return (
      <div className="bg-neutral-900 w-full h-full flex items-center justify-center">
        Loading Map...
      </div>
    );
  }

  return (
    <div className="w-full h-full z-0 relative">
      <MapContainer
        center={dronePosition}
        zoom={18}
        style={{ height: '100%', width: '100%' }}
        ref={(m: L.Map | null) => {
          mapRef.current = m;
        }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={dronePosition} icon={droneIcon(heading)}>
          <Popup>Drone</Popup>
        </Marker>
        {waypoints.map((w, i) => (
          <Marker
            key={w.id}
            position={[w.lat, w.lon]}
            icon={waypointIcon(i + 1, executing && i === activeIndex)}
          >
            <Popup>
              WP {i + 1}
              <br />
              {w.lat.toFixed(5)}, {w.lon.toFixed(5)}
              <br />
              alt {w.alt} m
            </Popup>
          </Marker>
        ))}
        <MapClickHandler onClick={add} />
      </MapContainer>

      <div className="absolute top-2 left-2 z-[400] bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-neutral-700 shadow-xl">
        <h3 className="text-xs font-bold text-neutral-300">MISSION MAP</h3>
      </div>

      <WaypointPanel />
    </div>
  );
}
