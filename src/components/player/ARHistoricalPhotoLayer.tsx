"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface ARHistoricalPhotoLayerProps {
  photoUrl: string;
  credit: string | null;
  /** Distance in metres from player to target */
  distance: number | null;
  /** Is the target currently inside the camera field of view */
  insideFov: boolean;
}

// Opacity ramps up as the player gets closer to the target.
// Below FADE_IN_MAX: invisible. Below FADE_IN_MIN: fully at MAX_OPACITY.
const FADE_IN_MAX = 80; // metres — start showing
const FADE_IN_MIN = 20; // metres — fully visible
const MAX_OPACITY = 0.65;

function computeOpacity(distance: number | null): number {
  if (distance === null) return 0;
  if (distance >= FADE_IN_MAX) return 0;
  if (distance <= FADE_IN_MIN) return MAX_OPACITY;
  const t = (FADE_IN_MAX - distance) / (FADE_IN_MAX - FADE_IN_MIN);
  return MAX_OPACITY * t;
}

/**
 * Semi-transparent historical photo / engraving overlay shown on top of the
 * live AR camera feed. Appears when the player gets close AND is pointing
 * roughly at the target. Gives a "time travel" feeling — the player sees
 * the monument as it was centuries ago, superimposed on what they see today.
 */
export function ARHistoricalPhotoLayer({
  photoUrl,
  credit,
  distance,
  insideFov,
}: ARHistoricalPhotoLayerProps) {
  const [visible, setVisible] = useState(true);
  const targetOpacity = computeOpacity(distance);
  const opacity = visible && insideFov ? targetOpacity : 0;

  if (targetOpacity === 0 && !visible) return null;

  return (
    <>
      {/* Photo overlay — centred, covers roughly the middle 80% of the screen */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-500"
        style={{ opacity }}
      >
        <img
          src={photoUrl}
          alt=""
          className="max-h-[80%] max-w-[90%] rounded-sm shadow-2xl"
          style={{
            mixBlendMode: "screen",
            filter: "sepia(0.3) contrast(1.05)",
          }}
        />
      </div>

      {/* Toggle button (only visible once the photo is available) */}
      {targetOpacity > 0 && (
        <button
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide historical photo" : "Show historical photo"}
          className="absolute right-4 top-[70px] z-10 rounded-full border border-amber-400/40 bg-slate-950/70 p-2 text-amber-200 backdrop-blur-sm hover:bg-slate-900"
        >
          {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>
      )}

      {/* Credit badge */}
      {visible && opacity > 0.1 && credit && (
        <div className="pointer-events-none absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full bg-slate-950/80 px-3 py-1 text-[10px] text-amber-100/80 backdrop-blur-sm">
          📜 {credit}
        </div>
      )}
    </>
  );
}
