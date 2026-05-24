"use client";

import { useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Circle,
  Tooltip,
  Marker,
  Popup,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default icon paths in Next.js
// (delete is allowed via the Record<string, unknown> cast which marks all
//  members as optional, satisfying TS strict-mode `delete` constraints)
const _iconProto = L.Icon.Default.prototype as unknown as Record<
  string,
  unknown
>;
delete _iconProto._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface Stop {
  step: number;
  name: string;
  lat: number;
  lon: number;
  radius: number;
}

interface TracePoint {
  lat: number;
  lon: number;
  accuracy?: number | null;
  step?: number | null;
  t: string;
}

interface Completion {
  step: number;
  completed_at: string;
}

interface Props {
  stops: Stop[];
  trace: TracePoint[];
  completions?: Completion[];
  currentStep?: number;
  playerLastPosition?: { lat: number; lon: number } | null;
  height?: string;
}

export default function SessionTraceMapInner({
  stops,
  trace,
  completions = [],
  currentStep,
  playerLastPosition,
  height = "600px",
}: Props) {
  const completedSet = useMemo(
    () => new Set(completions.map((c) => c.step)),
    [completions],
  );

  // Compute map center + bounds
  const allPoints: [number, number][] = [
    ...stops.map((s) => [s.lat, s.lon] as [number, number]),
    ...trace.map((t) => [t.lat, t.lon] as [number, number]),
  ];
  if (playerLastPosition) {
    allPoints.push([playerLastPosition.lat, playerLastPosition.lon]);
  }

  if (allPoints.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-slate-900 text-slate-400 text-sm rounded-xl"
        style={{ height }}
      >
        Aucune position à afficher pour le moment.
      </div>
    );
  }

  // Center on the mean (simple, good enough for short walks)
  const centerLat =
    allPoints.reduce((s, p) => s + p[0], 0) / allPoints.length;
  const centerLon =
    allPoints.reduce((s, p) => s + p[1], 0) / allPoints.length;

  const tracePolyline = trace.map((t) => [t.lat, t.lon] as [number, number]);

  return (
    <div className="rounded-xl overflow-hidden border border-zinc-800" style={{ height }}>
      <MapContainer
        center={[centerLat, centerLon]}
        zoom={17}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        {/* Stops : cercle = validation radius, marker = position */}
        {stops.map((s) => {
          const done = completedSet.has(s.step);
          const current = currentStep === s.step;
          const color = done
            ? "#10b981"
            : current
              ? "#f59e0b"
              : "#64748b";
          return (
            <div key={`stop-${s.step}`}>
              <Circle
                center={[s.lat, s.lon]}
                radius={s.radius}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.15,
                  weight: 2,
                  dashArray: current ? undefined : "6 4",
                }}
              />
              <CircleMarker
                center={[s.lat, s.lon]}
                radius={8}
                pathOptions={{
                  color: "#fff",
                  fillColor: color,
                  fillOpacity: 1,
                  weight: 2,
                }}
              >
                <Tooltip permanent direction="top" offset={[0, -10]}>
                  <span className="text-xs font-bold">
                    {s.step}. {s.name}
                  </span>
                </Tooltip>
                <Popup>
                  <div className="text-xs">
                    <p className="font-bold">
                      Step {s.step} — {s.name}
                    </p>
                    <p>
                      GPS : {s.lat.toFixed(6)}, {s.lon.toFixed(6)}
                    </p>
                    <p>Rayon validation : {s.radius} m</p>
                    <p>
                      {done
                        ? "✅ Validé"
                        : current
                          ? "🟡 En cours"
                          : "⚪ À venir"}
                    </p>
                  </div>
                </Popup>
              </CircleMarker>
            </div>
          );
        })}

        {/* Trace polyline (player path) */}
        {tracePolyline.length >= 2 && (
          <Polyline
            positions={tracePolyline}
            pathOptions={{
              color: "#3b82f6",
              weight: 3,
              opacity: 0.7,
            }}
          />
        )}

        {/* Trace points (small dots) — sample 1 on 3 to éviter saturation */}
        {trace
          .filter((_, i) => i % 3 === 0)
          .map((t, i) => (
            <CircleMarker
              key={`trace-${i}`}
              center={[t.lat, t.lon]}
              radius={3}
              pathOptions={{
                color: "#3b82f6",
                fillColor: "#3b82f6",
                fillOpacity: 0.6,
                weight: 1,
              }}
            >
              <Popup>
                <div className="text-xs">
                  <p>{new Date(t.t).toLocaleTimeString()}</p>
                  {typeof t.accuracy === "number" && (
                    <p>Précision : {Math.round(t.accuracy)} m</p>
                  )}
                  {typeof t.step === "number" && <p>Step actif : {t.step}</p>}
                </div>
              </Popup>
            </CircleMarker>
          ))}

        {/* Last known player position — gros marker rouge */}
        {playerLastPosition && (
          <Marker position={[playerLastPosition.lat, playerLastPosition.lon]}>
            <Popup>
              <div className="text-xs">
                <p className="font-bold">📍 Position actuelle joueur</p>
                <p>
                  {playerLastPosition.lat.toFixed(6)},{" "}
                  {playerLastPosition.lon.toFixed(6)}
                </p>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
