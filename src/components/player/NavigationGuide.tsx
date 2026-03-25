"use client";

import { useEffect, useState } from "react";
import { calculateBearing, formatDistance } from "@/lib/geo";
import { Navigation, Footprints } from "lucide-react";

interface NavigationGuideProps {
  playerLat: number | null;
  playerLon: number | null;
  targetLat: number | null;
  targetLon: number | null;
  distance: number | null;
  label?: string;
}

export function NavigationGuide({
  playerLat,
  playerLon,
  targetLat,
  targetLon,
  distance,
  label = "Suivez la direction",
}: NavigationGuideProps) {
  const [heading, setHeading] = useState<number>(0);
  const [hasCompass, setHasCompass] = useState(false);

  // Device orientation (compass heading)
  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      // iOS uses webkitCompassHeading, Android uses alpha
      const compassHeading =
        (e as DeviceOrientationEvent & { webkitCompassHeading?: number })
          .webkitCompassHeading ??
        (e.alpha !== null ? (360 - e.alpha) % 360 : null);

      if (compassHeading !== null) {
        setHeading(compassHeading);
        setHasCompass(true);
      }
    };

    // Request permission on iOS 13+
    if (
      typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
        .requestPermission === "function"
    ) {
      (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> })
        .requestPermission()
        .then((permission) => {
          if (permission === "granted") {
            window.addEventListener("deviceorientation", handleOrientation, true);
          }
        })
        .catch(() => {});
    } else {
      window.addEventListener("deviceorientation", handleOrientation, true);
    }

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
    };
  }, []);

  if (playerLat === null || playerLon === null || targetLat === null || targetLon === null) {
    return null;
  }

  const bearing = calculateBearing(playerLat, playerLon, targetLat, targetLon);
  const rotation = bearing - heading;

  // Estimate walking time (~5 km/h = 83m/min)
  const walkingMinutes = distance !== null ? Math.max(1, Math.round(distance / 83)) : null;

  // Cardinal direction text
  const getCardinalDirection = (deg: number) => {
    const dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  };

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-900/80 border border-emerald-900/30">
      {/* Compass arrow */}
      <div className="relative flex-shrink-0">
        <div className="w-16 h-16 rounded-full border-2 border-emerald-800/50 bg-slate-950 flex items-center justify-center shadow-inner">
          {/* Cardinal marks */}
          <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-emerald-600">N</span>
          <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] text-zinc-600">S</span>
          <span className="absolute top-1/2 -right-0.5 -translate-y-1/2 text-[8px] text-zinc-600">E</span>
          <span className="absolute top-1/2 -left-0.5 -translate-y-1/2 text-[8px] text-zinc-600">O</span>

          {/* Arrow */}
          <svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            className="drop-shadow-lg"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: "transform 0.3s ease-out",
            }}
          >
            <polygon
              points="20,4 26,22 20,18 14,22"
              fill="#10b981"
              stroke="#064e3b"
              strokeWidth="0.5"
            />
            <polygon
              points="20,36 26,22 20,26 14,22"
              fill="#1e293b"
              stroke="#064e3b"
              strokeWidth="0.5"
            />
            <circle cx="20" cy="20" r="2.5" fill="#064e3b" stroke="#10b981" strokeWidth="1" />
          </svg>
        </div>
        {/* Pulse when close */}
        {distance !== null && distance < 100 && (
          <div className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-30" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <Navigation className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-xs text-emerald-400 font-medium">{label}</span>
        </div>

        {distance !== null ? (
          <>
            <p className="text-lg font-bold text-white">
              {formatDistance(distance)}
              <span className="text-xs text-zinc-500 font-normal ml-2">
                {hasCompass ? `vers le ${getCardinalDirection(bearing)}` : `direction ${getCardinalDirection(bearing)}`}
              </span>
            </p>
            {walkingMinutes !== null && (
              <div className="flex items-center gap-1 mt-0.5">
                <Footprints className="h-3 w-3 text-zinc-500" />
                <span className="text-xs text-zinc-500">
                  ~{walkingMinutes} min a pied
                </span>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-zinc-500">Localisation en cours...</p>
        )}

        {!hasCompass && distance !== null && (
          <p className="text-[10px] text-zinc-600 mt-1">
            Bougez votre telephone pour activer la boussole
          </p>
        )}
      </div>
    </div>
  );
}
