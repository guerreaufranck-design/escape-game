"use client";

import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MAP_TILE_URL, MAP_ATTRIBUTION } from "@/lib/constants";

// Fix Leaflet default icon issue with Next.js bundler
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const playerIcon = new L.DivIcon({
  className: "player-marker",
  html: `<div style="
    width: 20px;
    height: 20px;
    background: #3b82f6;
    border: 3px solid #ffffff;
    border-radius: 50%;
    box-shadow: 0 0 12px rgba(59,130,246,0.6);
  "></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

interface GameMapInnerProps {
  playerLat: number | null;
  playerLon: number | null;
  targetLat: number | null;
  targetLon: number | null;
  validationRadius: number;
  zoom?: number;
}

function MapUpdater({
  playerLat,
  playerLon,
}: {
  playerLat: number | null;
  playerLon: number | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (playerLat !== null && playerLon !== null) {
      map.setView([playerLat, playerLon], map.getZoom(), { animate: true });
    }
  }, [map, playerLat, playerLon]);

  return null;
}

export default function GameMapInner({
  playerLat,
  playerLon,
  targetLat,
  targetLon,
  validationRadius,
  zoom = 15,
}: GameMapInnerProps) {
  const centerLat = playerLat ?? targetLat ?? 48.8566;
  const centerLon = playerLon ?? targetLon ?? 2.3522;

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-900/50 shadow-lg shadow-emerald-900/10">
      <MapContainer
        center={[centerLat, centerLon]}
        zoom={zoom}
        className="h-64 w-full"
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url={MAP_TILE_URL} attribution={MAP_ATTRIBUTION} />

        <MapUpdater playerLat={playerLat} playerLon={playerLon} />

        {/* Player position */}
        {playerLat !== null && playerLon !== null && (
          <Marker position={[playerLat, playerLon]} icon={playerIcon} />
        )}

        {/* Target zone */}
        {targetLat !== null && targetLon !== null && (
          <>
            <Circle
              center={[targetLat, targetLon]}
              radius={validationRadius}
              pathOptions={{
                color: "#10b981",
                fillColor: "#10b981",
                fillOpacity: 0.15,
                weight: 2,
                dashArray: "8 4",
              }}
            />
            <Circle
              center={[targetLat, targetLon]}
              radius={validationRadius * 3}
              pathOptions={{
                color: "#10b981",
                fillColor: "#10b981",
                fillOpacity: 0.05,
                weight: 1,
                dashArray: "4 8",
              }}
            />
          </>
        )}
      </MapContainer>
    </div>
  );
}
