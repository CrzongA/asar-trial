import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix leaflet icon issue in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

import { useRos } from './RosProvider';
import * as ROSLIB from 'roslib';

export default function MissionMap() {
  const { ros, connected } = useRos();
  const [mounted, setMounted] = useState(false);
  const [dronePosition, setDronePosition] = useState<[number, number]>([47.397742, 8.545594]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!ros || !connected) return;

    const gpsSub = new ROSLIB.Topic({
      ros: ros,
      name: '/fmu/out/vehicle_global_position',
      messageType: 'px4_msgs/msg/VehicleGlobalPosition'
    });

    gpsSub.subscribe((msg: any) => {
      setDronePosition([msg.lat, msg.lon]);
    });

    return () => gpsSub.unsubscribe();
  }, [ros, connected]);

  if (!mounted) return <div className="bg-neutral-900 w-full h-full flex items-center justify-center">Loading Map...</div>;

  return (
    <div className="w-full h-full z-0 relative">
      <MapContainer center={dronePosition} zoom={16} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={dronePosition}>
          <Popup>
            Drone Current Position
          </Popup>
        </Marker>
      </MapContainer>
      <div className="absolute top-2 left-2 z-[400] bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-neutral-700 shadow-xl">
        <h3 className="text-xs font-bold text-neutral-300">MISSION MAP</h3>
      </div>
    </div>
  );
}
