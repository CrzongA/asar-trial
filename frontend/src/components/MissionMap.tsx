"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMapEvents } from 'react-leaflet';
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

const targetIcon = new L.DivIcon({
  className: 'target-marker',
  html: `<div style="width:28px;height:28px;border-radius:50%;background:#ef4444;border:3px solid white;box-shadow:0 0 0 4px rgba(239,68,68,0.4);animation:pulse 1.6s ease-in-out infinite"></div>
    <style>@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,0.6)}70%{box-shadow:0 0 0 14px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}</style>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const sarWaypointIcon = (idx: number) =>
  new L.DivIcon({
    className: 'sar-waypoint',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:#22d3ee;border:2px solid white;color:#0e7490;font-size:9px;font-weight:bold;display:flex;align-items:center;justify-content:center">${idx}</div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

import { useRos } from './RosProvider';
import * as ROSLIB from 'roslib';
import { useWaypoints } from '@/hooks/useWaypoints';
import WaypointPanel from './WaypointPanel';

interface PlannedMission {
  center: [number, number];
  radiusM: number;
  altitudeM: number;
  waypoints: Array<[number, number]>;
}

interface FoundTarget {
  lat: number;
  lon: number;
  confidence: number;
}

function MapClickHandler({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click: e => onClick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

export default function MissionMap({ isMini = false }: { isMini?: boolean }) {
  const { ros, connected } = useRos();
  const { waypoints, activeIndex, executing, add } = useWaypoints();
  const [mounted, setMounted] = useState(false);
  const [dronePosition, setDronePosition] = useState<[number, number]>([47.397742, 8.545594]);
  const [heading, setHeading] = useState(0);
  const [haveFix, setHaveFix] = useState(false);
  const [plan, setPlan] = useState<PlannedMission | null>(null);
  const [target, setTarget] = useState<FoundTarget | null>(null);
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

  useEffect(() => {
    if (!ros || !connected) return;

    const planSub = new ROSLIB.Topic({
      ros,
      name: '/sar/planned_waypoints',
      messageType: 'std_msgs/msg/String',
    });
    const statusSub = new ROSLIB.Topic({
      ros,
      name: '/mission/target_status',
      messageType: 'asar_msgs/msg/TargetStatus',
    });
    const stateSub = new ROSLIB.Topic({
      ros,
      name: '/sar/state',
      messageType: 'std_msgs/msg/String',
    });

    planSub.subscribe(raw => {
      const m = raw as { data: string };
      try {
        const payload = JSON.parse(m.data);
        setPlan({
          center: payload.center,
          radiusM: payload.radius_m,
          altitudeM: payload.altitude_m,
          waypoints: payload.waypoints,
        });
      } catch {
        // ignore malformed
      }
    });

    statusSub.subscribe(raw => {
      const m = raw as { found?: boolean; latitude: number; longitude: number; confidence: number };
      if (m?.found) {
        setTarget({ lat: m.latitude, lon: m.longitude, confidence: m.confidence });
      }
    });

    stateSub.subscribe(raw => {
      const m = raw as { data: string };
      // Reset map overlay state when a fresh mission starts.
      if (m.data === 'IDLE' || m.data === 'BRIEFING') {
        setTarget(null);
      }
    });

    return () => {
      planSub.unsubscribe();
      statusSub.unsubscribe();
      stateSub.unsubscribe();
    };
  }, [ros, connected]);

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
        zoom={isMini ? 16 : 18}
        zoomControl={!isMini}
        scrollWheelZoom={!isMini}
        dragging={!isMini}
        style={{ height: '100%', width: '100%' }}
        ref={(m: L.Map | null) => {
          mapRef.current = m;
        }}
      >
        <TileLayer
          attribution={isMini ? '' : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}
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
        {plan && (
          <>
            <Circle
              center={plan.center}
              radius={plan.radiusM}
              pathOptions={{
                color: '#22d3ee',
                weight: 1,
                fillColor: '#22d3ee',
                fillOpacity: 0.07,
                dashArray: '4 6',
              }}
            />
            <Polyline
              positions={plan.waypoints}
              pathOptions={{ color: '#22d3ee', weight: 2, opacity: 0.7 }}
            />
            {plan.waypoints.map((wp, i) => (
              <Marker key={`sar-wp-${i}`} position={wp} icon={sarWaypointIcon(i + 1)}>
                <Popup>
                  SAR WP {i + 1}
                  <br />
                  {wp[0].toFixed(5)}, {wp[1].toFixed(5)}
                  <br />
                  alt {plan.altitudeM} m
                </Popup>
              </Marker>
            ))}
          </>
        )}
        {target && (
          <Marker position={[target.lat, target.lon]} icon={targetIcon}>
            <Popup>
              Target
              <br />
              {target.lat.toFixed(5)}, {target.lon.toFixed(5)}
              <br />
              conf {target.confidence.toFixed(2)}
            </Popup>
          </Marker>
        )}
        {!isMini && <MapClickHandler onClick={add} />}
      </MapContainer>

      {!isMini && (
        <>
          <div className="absolute bottom-2 left-2 z-[400] bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-neutral-700 shadow-xl">
            <h3 className="text-xs font-bold text-neutral-300">MISSION MAP</h3>
          </div>
          <WaypointPanel />
        </>
      )}
    </div>
  );
}

