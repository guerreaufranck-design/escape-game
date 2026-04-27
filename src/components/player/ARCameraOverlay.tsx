"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  Compass as CompassIcon,
  Navigation2,
  AlertTriangle,
} from "lucide-react";
import { calculateBearing, formatDistance } from "@/lib/geo";
import { useDeviceOrientation } from "@/hooks/useDeviceOrientation";
import { tt } from "@/lib/translations";
import { ARFacadeTextLayer } from "./ARFacadeTextLayer";
import { ARCharacterSpeaker } from "./ARCharacterSpeaker";

interface ARCameraOverlayProps {
  playerLat: number | null;
  playerLon: number | null;
  targetLat: number | null;
  targetLon: number | null;
  distance: number | null;
  locale?: string;
  onClose: () => void;
  /** Optional short "painted" text that appears on the facade when locked on */
  facadeText?: string | null;
  /**
   * When true, the facadeText is THE answer (virtual_ar stop). Rendered
   * bigger and with a "Réponse révélée" label. When false, it's a hint.
   */
  facadeTextIsAnswer?: boolean;
  /** Current step key — used by the character speaker to reset between steps */
  stepKey?: string | null;
  /** Optional animated character that talks to the player when locked on */
  character?: { type: string; dialogue: string } | null;
  // Legacy props — kept for backwards compatibility with the play page,
  // but these layers were removed from the AR scene to reduce clutter.
  // The treasure reward is now shown in the post-validation success modal,
  // and historical Wikipedia photos were dropped because they overlapped
  // and competed visually with the character sprite.
  /** @deprecated no longer rendered — kept for prop-shape backwards compat */
  historicalPhotoUrl?: string | null;
  /** @deprecated no longer rendered — kept for prop-shape backwards compat */
  historicalPhotoCredit?: string | null;
  /** @deprecated no longer rendered in AR; shown in success modal instead */
  treasureReward?: string | null;
  /** @deprecated no longer rendered in AR; chest is gone */
  onChestOpen?: () => void;
}

// --- Tuning constants ----------------------------------------------------
const HORIZONTAL_FOV = 65; // horizontal field of view of an average phone camera (deg)
const VERTICAL_FOV = 45; // approximate vertical FOV (deg)
const LOCK_ON_ANGLE = 10; // deg tolerance to consider "lined up"
const LOCK_ON_DISTANCE = 50; // metres to consider "at the target"
// -----------------------------------------------------------------------

/**
 * Fullscreen live-camera view with a world-anchored waypoint marker
 * that reacts to heading AND pitch, a 360° radar mini-map, distance
 * rings, a horizon line and a lock-on animation. All values are
 * smoothed by the underlying orientation hook to avoid jitter.
 */
export function ARCameraOverlay({
  playerLat,
  playerLon,
  targetLat,
  targetLon,
  distance,
  locale = "fr",
  onClose,
  facadeText = null,
  facadeTextIsAnswer = false,
  stepKey = null,
  character = null,
}: ARCameraOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const orientation = useDeviceOrientation();
  const [lockedOn, setLockedOn] = useState(false);
  const vibratedRef = useRef(false);

  // Start/stop the rear camera stream
  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch {
        setCameraError(tt("ar.cameraError", locale));
      }
    }
    start();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [locale]);

  const hasGps =
    playerLat !== null &&
    playerLon !== null &&
    targetLat !== null &&
    targetLon !== null;

  // --- Bearing / angle maths --------------------------------------------
  const bearing = hasGps
    ? calculateBearing(playerLat!, playerLon!, targetLat!, targetLon!)
    : 0;

  // Horizontal: difference between target bearing and phone heading.
  // 0 => straight ahead, positive => right, negative => left.
  const rawHorizontal = bearing - orientation.heading;
  const horizontalAngle = ((rawHorizontal + 540) % 360) - 180;

  // Vertical: when the phone is held vertically (beta ≈ 90°), targets
  // at ground level should appear roughly at the horizon line of the
  // camera view. We centre the "eye level" on beta = 90° and let the
  // marker drift up when the phone tilts down, and down when tilts up.
  // (Mirror of how the real world moves through the camera window.)
  const verticalAngle = 90 - orientation.pitch;

  const absH = Math.abs(horizontalAngle);
  const absV = Math.abs(verticalAngle);
  const insideFov =
    absH < HORIZONTAL_FOV / 2 && absV < VERTICAL_FOV / 2;

  // Project (horizontalAngle, verticalAngle) → screen coordinates (%)
  // Horizontal: 0° = centre, ±(FOV/2) = edges of screen.
  const markerLeftPct = 50 + (horizontalAngle / (HORIZONTAL_FOV / 2)) * 50;
  // Vertical: same idea, flipped because screen Y grows downward.
  const markerTopPct = 50 + (verticalAngle / (VERTICAL_FOV / 2)) * 50;

  // Horizon line position: vertical pixel where real-world horizon sits
  // given the current pitch of the phone.
  const horizonTopPct = 50 + (verticalAngle / (VERTICAL_FOV / 2)) * 50;
  const horizonInView = horizonTopPct > -10 && horizonTopPct < 110;

  // --- Distance ring colour ---------------------------------------------
  // Gives the player instant feedback about how close they are to the
  // target without having to read a number.
  function getProximityRing() {
    if (distance === null)
      return { color: "border-slate-400", glow: "shadow-slate-500/30", label: "--" };
    if (distance < 50)
      return {
        color: "border-emerald-400",
        glow: "shadow-emerald-500/70",
        label: tt("ar.zoneVeryClose", locale),
      };
    if (distance < 100)
      return {
        color: "border-lime-400",
        glow: "shadow-lime-500/60",
        label: tt("ar.zoneClose", locale),
      };
    if (distance < 200)
      return {
        color: "border-yellow-400",
        glow: "shadow-yellow-500/50",
        label: tt("ar.zoneMedium", locale),
      };
    if (distance < 500)
      return {
        color: "border-orange-400",
        glow: "shadow-orange-500/40",
        label: tt("ar.zoneFar", locale),
      };
    return {
      color: "border-red-500",
      glow: "shadow-red-500/30",
      label: tt("ar.zoneVeryFar", locale),
    };
  }
  const ring = getProximityRing();

  // --- Lock-on detection ------------------------------------------------
  useEffect(() => {
    const onTarget =
      hasGps &&
      orientation.hasCompass &&
      absH < LOCK_ON_ANGLE &&
      distance !== null &&
      distance < LOCK_ON_DISTANCE;
    setLockedOn(onTarget);
    if (onTarget && !vibratedRef.current) {
      vibratedRef.current = true;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate?.(60);
        } catch {
          /* vibration can fail silently on desktops or strict modes */
        }
      }
    } else if (!onTarget) {
      vibratedRef.current = false;
    }
  }, [absH, distance, hasGps, orientation.hasCompass]);

  // --- Radar maths ------------------------------------------------------
  // Place the target as a dot on a circular radar, rotated so that the
  // top of the radar always represents "in front of the player".
  const radarSize = 110; // px
  const radarRadius = radarSize / 2 - 12;
  // Convert the *horizontal* angle (relative to the phone facing) into
  // a position on the radar circle. 0° = top, clockwise.
  const radarAngleRad = (horizontalAngle * Math.PI) / 180;
  const radarDotX = radarSize / 2 + Math.sin(radarAngleRad) * radarRadius;
  const radarDotY = radarSize / 2 - Math.cos(radarAngleRad) * radarRadius;

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      {/* Camera feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Facade-painted text — appears when locked on. Either a hint
          (physical stops) or the actual answer (virtual_ar stops). */}
      {facadeText && cameraReady && orientation.hasCompass && (
        <ARFacadeTextLayer
          text={facadeText}
          lockedOn={lockedOn}
          horizontalAngle={horizontalAngle}
          isAnswer={facadeTextIsAnswer}
        />
      )}

      {/* Darkening vignette */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/70" />

      {cameraError && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 p-6 text-center">
          <div className="max-w-sm space-y-3">
            <AlertTriangle className="mx-auto h-10 w-10 text-orange-400" />
            <p className="text-sm text-slate-200">{cameraError}</p>
            <button
              onClick={onClose}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              {tt("ar.close", locale)}
            </button>
          </div>
        </div>
      )}

      {/* Virtual horizon line */}
      {cameraReady && orientation.hasCompass && horizonInView && (
        <div
          className="pointer-events-none absolute left-0 right-0 h-px bg-emerald-400/40"
          style={{
            top: `${horizonTopPct}%`,
            transform: `rotate(${orientation.roll}deg)`,
            transformOrigin: "center",
          }}
        >
          {/* Dashed segments for a pro HUD look */}
          <div className="h-full w-full bg-[linear-gradient(90deg,transparent_0,transparent_10%,rgba(52,211,153,0.5)_10%,rgba(52,211,153,0.5)_20%,transparent_20%,transparent_30%,rgba(52,211,153,0.5)_30%,rgba(52,211,153,0.5)_40%,transparent_40%,transparent_60%,rgba(52,211,153,0.5)_60%,rgba(52,211,153,0.5)_70%,transparent_70%,transparent_80%,rgba(52,211,153,0.5)_80%,rgba(52,211,153,0.5)_90%,transparent_90%)]" />
        </div>
      )}

      {/* Top bar: label + close */}
      <div className="absolute left-0 right-0 top-0 flex items-start justify-between p-4">
        <div className="rounded-full border border-emerald-500/40 bg-slate-950/70 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-emerald-300 backdrop-blur-sm">
          {tt("ar.label", locale)}
        </div>
        <button
          onClick={onClose}
          aria-label={tt("ar.close", locale)}
          className="rounded-full border border-white/20 bg-slate-950/70 p-2 text-white backdrop-blur-sm hover:bg-slate-900"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* 360° radar mini-map (top-left) */}
      {cameraReady && hasGps && orientation.hasCompass && (
        <div className="absolute left-4 top-16">
          <div
            className="relative rounded-full border-2 border-emerald-500/40 bg-slate-950/70 shadow-lg backdrop-blur-sm"
            style={{ width: radarSize, height: radarSize }}
          >
            {/* Inner rings */}
            <div className="absolute inset-3 rounded-full border border-emerald-500/20" />
            <div className="absolute inset-6 rounded-full border border-emerald-500/15" />
            {/* Cross-hair */}
            <div className="absolute left-1/2 top-2 h-3 w-px bg-emerald-500/40 -translate-x-1/2" />
            <div className="absolute bottom-2 left-1/2 h-3 w-px bg-emerald-500/40 -translate-x-1/2" />
            <div className="absolute top-1/2 left-2 h-px w-3 bg-emerald-500/40 -translate-y-1/2" />
            <div className="absolute top-1/2 right-2 h-px w-3 bg-emerald-500/40 -translate-y-1/2" />
            {/* N label */}
            <div
              className="absolute left-1/2 top-1 -translate-x-1/2 text-[9px] font-bold text-emerald-300"
              style={{
                transform: `translateX(-50%) rotate(${-orientation.heading}deg) translateY(0)`,
                transformOrigin: `0 ${radarSize / 2 - 4}px`,
              }}
            >
              N
            </div>
            {/* Player (centre) */}
            <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
            {/* Target dot */}
            <div
              className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                lockedOn
                  ? "bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.9)]"
                  : "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]"
              } transition-colors`}
              style={{ left: radarDotX, top: radarDotY }}
            />
            {/* Facing cone */}
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 h-full w-full"
              style={{ transform: "translate(-50%, -50%)" }}
            >
              <div
                className="absolute left-1/2 top-1/2 h-0 w-0 -translate-x-1/2 -translate-y-1/2"
                style={{
                  borderLeft: `${radarRadius * 0.6}px solid transparent`,
                  borderRight: `${radarRadius * 0.6}px solid transparent`,
                  borderBottom: `${radarRadius}px solid rgba(52, 211, 153, 0.12)`,
                  transform: `translate(-50%, -100%)`,
                  transformOrigin: "50% 100%",
                }}
              />
            </div>
          </div>
          <p className="mt-1 text-center text-[9px] uppercase tracking-wider text-emerald-300/80">
            {tt("ar.radar", locale)}
          </p>
        </div>
      )}

      {/* iOS permission prompt */}
      {orientation.permissionState !== "granted" &&
        orientation.permissionState !== "unsupported" && (
          <div className="absolute left-1/2 top-20 -translate-x-1/2 rounded-xl border border-emerald-500/40 bg-slate-950/90 p-4 text-center shadow-xl backdrop-blur-sm">
            <p className="mb-3 text-xs text-slate-200">
              {tt("ar.enableCompass", locale)}
            </p>
            <button
              onClick={orientation.requestPermission}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              <CompassIcon className="h-4 w-4" />
              {tt("ar.activate", locale)}
            </button>
          </div>
        )}

      {/* World-anchored waypoint marker (inside FOV) */}
      {cameraReady && hasGps && orientation.hasCompass && insideFov && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-75 ease-out"
          style={{
            left: `${markerLeftPct}%`,
            top: `${markerTopPct}%`,
          }}
        >
          <div className={`flex flex-col items-center gap-2`}>
            {/* Concentric distance rings */}
            <div className="relative flex h-28 w-28 items-center justify-center">
              {/* Outer soft glow ring */}
              <div
                className={`absolute inset-0 rounded-full border-2 ${ring.color} ${ring.glow} shadow-[0_0_30px] opacity-40`}
              />
              {/* Middle ring */}
              <div
                className={`absolute inset-3 rounded-full border ${ring.color} opacity-60`}
              />
              {/* Core */}
              <div
                className={`relative flex h-16 w-16 items-center justify-center rounded-full border-2 ${
                  lockedOn
                    ? "border-emerald-300 bg-emerald-500/40"
                    : `${ring.color} bg-emerald-500/20`
                } backdrop-blur-sm`}
              >
                <Navigation2
                  className={`h-8 w-8 ${
                    lockedOn ? "text-emerald-100" : "text-emerald-200"
                  }`}
                  strokeWidth={2.5}
                />
              </div>
              {/* Lock-on pulse */}
              {lockedOn && (
                <>
                  <div className="absolute inset-0 rounded-full border-2 border-emerald-300 animate-ping" />
                  <div className="absolute inset-2 rounded-full border-2 border-emerald-400/60 animate-ping [animation-delay:150ms]" />
                </>
              )}
            </div>
            {/* Distance label */}
            {distance !== null && (
              <div
                className={`rounded-full border bg-slate-950/85 px-3 py-1 text-sm font-bold shadow-lg backdrop-blur-sm ${
                  lockedOn
                    ? "border-emerald-300 text-emerald-100"
                    : `${ring.color} text-emerald-200`
                }`}
              >
                {formatDistance(distance)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Off-screen indicator (target outside FOV) */}
      {cameraReady && hasGps && orientation.hasCompass && !insideFov && (
        <div
          className={`absolute top-1/2 -translate-y-1/2 ${
            horizontalAngle > 0 ? "right-6" : "left-6"
          }`}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-full border-2 border-emerald-500/70 bg-emerald-500/20 p-4 shadow-2xl backdrop-blur-sm">
              <Navigation2
                className="h-10 w-10 text-emerald-300"
                strokeWidth={2.5}
                style={{
                  transform: `rotate(${horizontalAngle > 0 ? 90 : -90}deg)`,
                }}
              />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
              {horizontalAngle > 0
                ? tt("ar.turnRight", locale)
                : tt("ar.turnLeft", locale)}
            </p>
          </div>
        </div>
      )}

      {/* Bottom HUD */}
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <div className="mx-auto max-w-lg rounded-2xl border border-emerald-500/30 bg-slate-950/85 p-4 shadow-2xl backdrop-blur-md">
          {!hasGps ? (
            <p className="text-center text-sm text-slate-300">
              {tt("ar.waitingGps", locale)}
            </p>
          ) : !orientation.hasCompass ? (
            <p className="text-center text-sm text-slate-300">
              {tt("ar.movePhone", locale)}
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                    {tt("ar.distance", locale)}
                  </p>
                  <p className="text-2xl font-bold text-white">
                    {distance !== null ? formatDistance(distance) : "--"}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                    {tt("ar.zone", locale)}
                  </p>
                  <p
                    className={`text-base font-bold ${
                      lockedOn ? "text-emerald-300" : "text-white"
                    }`}
                  >
                    {ring.label}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                    {tt("ar.turn", locale)}
                  </p>
                  <p
                    className={`text-2xl font-bold ${
                      lockedOn ? "text-emerald-300" : "text-white"
                    }`}
                  >
                    {lockedOn ? "✓" : `${Math.round(absH)}°`}
                  </p>
                </div>
              </div>
              {lockedOn && (
                <p className="mt-2 text-center text-xs font-bold uppercase tracking-wider text-emerald-300 animate-pulse">
                  {tt("ar.lockedOn", locale)}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Animated character — the cinematic AR moment when player locks on */}
      {character && cameraReady && orientation.hasCompass && (
        <ARCharacterSpeaker
          lockedOn={lockedOn}
          characterType={character.type}
          dialogue={character.dialogue}
          stepKey={stepKey}
          locale={locale}
        />
      )}
    </div>
  );
}
