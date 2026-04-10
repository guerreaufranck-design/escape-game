"use client";

import { calculateBearing, formatDistance } from "@/lib/geo";
import { Navigation, Footprints } from "lucide-react";
import { tt } from "@/lib/translations";

interface NavigationGuideProps {
  playerLat: number | null;
  playerLon: number | null;
  targetLat: number | null;
  targetLon: number | null;
  distance: number | null;
  label?: string;
  locale?: string;
  navigationHint?: string | null;
}

/**
 * Compact navigation panel displayed under the map. Since the map now
 * embeds the DIVAN directional arrow (rotated from GPS bearing, no
 * device compass), the rotating compass rose that used to live here
 * is gone. What remains is the distance, walking time, a textual
 * cardinal direction and the optional walking hint.
 */
export function NavigationGuide({
  playerLat,
  playerLon,
  targetLat,
  targetLon,
  distance,
  label,
  locale = "fr",
  navigationHint,
}: NavigationGuideProps) {
  if (
    playerLat === null ||
    playerLon === null ||
    targetLat === null ||
    targetLon === null
  ) {
    return null;
  }

  const bearing = calculateBearing(playerLat, playerLon, targetLat, targetLon);

  // Estimated walking time (~5 km/h ≈ 83 m/min)
  const walkingMinutes =
    distance !== null ? Math.max(1, Math.round(distance / 83)) : null;

  const getCardinalDirection = (deg: number) => {
    const dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
    return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  };

  return (
    <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl bg-slate-900/80 border border-emerald-900/30">
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
                {`${tt("nav.direction", locale)} ${getCardinalDirection(bearing)}`}
              </span>
            </p>
            {walkingMinutes !== null && (
              <div className="flex items-center gap-1 mt-0.5">
                <Footprints className="h-3 w-3 text-zinc-500" />
                <span className="text-xs text-zinc-500">
                  ~{walkingMinutes} {tt("nav.walkMin", locale)}
                </span>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-zinc-500">{tt("nav.locating", locale)}</p>
        )}
      </div>

      {/* Textual walking directions */}
      {navigationHint && (
        <div className="w-full mt-2 pt-2 border-t border-emerald-900/30">
          <div className="flex items-start gap-2">
            <Footprints className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-400 leading-relaxed">
              {navigationHint}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
