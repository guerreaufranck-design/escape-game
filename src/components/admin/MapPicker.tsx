"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import {
  MAP_TILE_URL,
  MAP_ATTRIBUTION,
} from "@/lib/constants";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default marker icon
const icon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

interface MapPickerProps {
  lat: number;
  lng: number;
  onLocationChange: (lat: number, lng: number) => void;
}

function ClickHandler({
  onLocationChange,
}: {
  onLocationChange: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onLocationChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function RecenterMap({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const prevPos = useRef({ lat, lng });

  useEffect(() => {
    if (prevPos.current.lat !== lat || prevPos.current.lng !== lng) {
      map.setView([lat, lng], map.getZoom());
      prevPos.current = { lat, lng };
    }
  }, [lat, lng, map]);

  return null;
}

export default function MapPicker({ lat, lng, onLocationChange }: MapPickerProps) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={15}
      className="h-full w-full"
      style={{ background: "#1a1a2e" }}
    >
      <TileLayer url={MAP_TILE_URL} attribution={MAP_ATTRIBUTION} />
      <Marker position={[lat, lng]} icon={icon} />
      <ClickHandler onLocationChange={onLocationChange} />
      <RecenterMap lat={lat} lng={lng} />
    </MapContainer>
  );
}
