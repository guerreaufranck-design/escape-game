"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MAP_TILE_URL, MAP_ATTRIBUTION } from "@/lib/constants";
import { tt } from "@/lib/translations";
import { calculateBearing, haversineDistance, formatDistance } from "@/lib/geo";

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

const plainPlayerIcon = new L.DivIcon({
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

/**
 * DIVAN icon: the player dot surrounded by a large directional cone
 * that points at the current target. The rotation is done with pure
 * GPS bearing — no device compass required. The SVG is laid out so
 * the arrow's tip is at the top of the viewport (0 degrees = north)
 * and rotates clockwise as bearing increases.
 */
function buildDivanIcon(bearing: number): L.DivIcon {
  return new L.DivIcon({
    className: "player-marker-divan",
    html: `
      <div style="
        position: relative;
        width: 88px;
        height: 88px;
        pointer-events: none;
      ">
        <div style="
          position: absolute;
          left: 50%;
          top: 50%;
          width: 88px;
          height: 88px;
          transform: translate(-50%, -50%) rotate(${bearing}deg);
          transform-origin: center;
          transition: transform 250ms ease-out;
        ">
          <svg viewBox="0 0 88 88" width="88" height="88" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id="divanGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#10b981" stop-opacity="0.4" />
                <stop offset="70%" stop-color="#10b981" stop-opacity="0.05" />
                <stop offset="100%" stop-color="#10b981" stop-opacity="0" />
              </radialGradient>
            </defs>
            <circle cx="44" cy="44" r="44" fill="url(#divanGlow)" />
            <path
              d="M 44 4 L 58 36 L 44 28 L 30 36 Z"
              fill="#10b981"
              stroke="#064e3b"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <div style="
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 20px;
          height: 20px;
          background: #3b82f6;
          border: 3px solid #ffffff;
          border-radius: 50%;
          box-shadow: 0 0 12px rgba(59,130,246,0.6);
        "></div>
      </div>
    `,
    iconSize: [88, 88],
    iconAnchor: [44, 44],
  });
}

interface GameMapInnerProps {
  playerLat: number | null;
  playerLon: number | null;
  targetLat: number | null;
  targetLon: number | null;
  validationRadius: number;
  zoom?: number;
  locale?: string;
  fullHeight?: boolean;
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
  locale = "fr",
  fullHeight = false,
}: GameMapInnerProps) {
  const centerLat = playerLat ?? targetLat ?? 48.8566;
  const centerLon = playerLon ?? targetLon ?? 2.3522;
  const [expanded, setExpanded] = useState(false);

  const mapHeightClass = fullHeight
    ? "h-full"
    : expanded ? "h-[70vh]" : "h-56";

  // DIVAN: compute live GPS bearing and distance between player and
  // target. No device compass involved — purely derived from GPS
  // coordinates, so it always points at the next point to reach.
  const hasBothPoints =
    playerLat !== null &&
    playerLon !== null &&
    targetLat !== null &&
    targetLon !== null;

  const divanBearing = hasBothPoints
    ? calculateBearing(playerLat!, playerLon!, targetLat!, targetLon!)
    : 0;
  const divanDistance = hasBothPoints
    ? haversineDistance(playerLat!, playerLon!, targetLat!, targetLon!)
    : 0;
  const divanMidpoint: [number, number] | null = hasBothPoints
    ? [(playerLat! + targetLat!) / 2, (playerLon! + targetLon!) / 2]
    : null;

  // Memoise the icon so we only rebuild it when the bearing actually
  // changes (every tiny GPS jitter would otherwise create a new icon
  // and force Leaflet to redraw the DOM).
  const playerIcon = useMemo(() => {
    if (!hasBothPoints) return plainPlayerIcon;
    return buildDivanIcon(divanBearing);
  }, [hasBothPoints, divanBearing]);

  return (
    <div className={`relative overflow-hidden ${fullHeight ? "h-full" : "rounded-xl border border-emerald-900/50 shadow-lg shadow-emerald-900/10"}`}>
      <MapContainer
        center={[centerLat, centerLon]}
        zoom={zoom}
        className={`w-full transition-all duration-300 ${mapHeightClass}`}
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

        {/* DIVAN: live line from player to target with distance badge */}
        {hasBothPoints && (
          <>
            <Polyline
              positions={[
                [playerLat!, playerLon!],
                [targetLat!, targetLon!],
              ]}
              pathOptions={{
                color: "#10b981",
                weight: 3,
                opacity: 0.65,
                dashArray: "10 8",
                lineCap: "round",
              }}
            />
            {divanMidpoint && (
              <Marker
                position={divanMidpoint}
                icon={new L.DivIcon({
                  className: "divan-distance-label",
                  html: `<div style="
                    background: rgba(2, 6, 23, 0.9);
                    border: 1px solid rgba(16, 185, 129, 0.5);
                    color: #6ee7b7;
                    padding: 2px 8px;
                    border-radius: 9999px;
                    font-size: 11px;
                    font-weight: 700;
                    white-space: nowrap;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                    backdrop-filter: blur(4px);
                  ">${formatDistance(divanDistance)}</div>`,
                  iconSize: [0, 0],
                  iconAnchor: [0, 0],
                })}
                interactive={false}
              />
            )}
          </>
        )}

        {/* Player position (DIVAN arrow merged into the icon when target is known) */}
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

      {/* Expand / Collapse toggle — hidden in fullHeight mode */}
      {!fullHeight && <button
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
            {tt('nav.reduce', locale)}
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
            {tt('nav.enlarge', locale)}
          </>
        )}
      </button>}
    </div>
  );
}
