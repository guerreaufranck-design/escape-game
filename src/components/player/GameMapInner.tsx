"use client";

import { useEffect, useState, useCallback } from "react";
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

function RecenterButton({
  playerLat,
  playerLon,
  targetLat,
  targetLon,
  defaultZoom,
}: {
  playerLat: number | null;
  playerLon: number | null;
  targetLat: number | null;
  targetLon: number | null;
  defaultZoom: number;
}) {
  const map = useMap();

  const handleRecenter = useCallback(() => {
    const lat = playerLat ?? targetLat;
    const lon = playerLon ?? targetLon;
    if (lat !== null && lon !== null) {
      map.setView([lat, lon], defaultZoom, { animate: true });
    }
  }, [map, playerLat, playerLon, targetLat, targetLon, defaultZoom]);

  return (
    <div className="leaflet-top leaflet-right" style={{ pointerEvents: "auto" }}>
      <div className="leaflet-control" style={{ margin: "10px" }}>
        <button
          onClick={handleRecenter}
          className="flex items-center justify-center w-9 h-9 bg-zinc-900/90 backdrop-blur border border-zinc-700 rounded-lg shadow-lg text-emerald-400 hover:bg-zinc-800 hover:text-emerald-300 transition-colors"
          title="Recentrer la carte"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
          </svg>
        </button>
      </div>
    </div>
  );
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
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="relative overflow-hidden rounded-xl border border-emerald-900/50 shadow-lg shadow-emerald-900/10">
      <MapContainer
        center={[centerLat, centerLon]}
        zoom={zoom}
        className={`w-full transition-all duration-300 ${expanded ? "h-[70vh]" : "h-56"}`}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url={MAP_TILE_URL} attribution={MAP_ATTRIBUTION} />

        <MapUpdater playerLat={playerLat} playerLon={playerLon} />

        <RecenterButton
          playerLat={playerLat}
          playerLon={playerLon}
          targetLat={targetLat}
          targetLon={targetLon}
          defaultZoom={zoom}
        />

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

      {/* Expand / Collapse toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900/90 backdrop-blur border border-zinc-700 rounded-full text-xs text-zinc-300 hover:text-emerald-400 hover:border-emerald-700 transition-colors shadow-lg"
      >
        {expanded ? (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
            Reduire
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
            Agrandir
          </>
        )}
      </button>
    </div>
  );
}
