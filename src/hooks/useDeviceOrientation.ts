"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface DeviceOrientationState {
  /** Smoothed compass heading (0 = North, clockwise) */
  heading: number;
  /** Smoothed device pitch in degrees. 0 = phone vertical, 90 = flat face-up, -90 = face-down */
  pitch: number;
  /** Smoothed device roll in degrees (screen rotation around Y axis) */
  roll: number;
  hasCompass: boolean;
  permissionState: "unknown" | "granted" | "denied" | "unsupported";
  requestPermission: () => Promise<void>;
}

/**
 * Exponential moving average coefficient used to smooth noisy
 * orientation values. Lower = more stable (more lag), higher = more
 * reactive (more jitter). 0.35 gives a perceptibly snappier response
 * than the default 0.15 while still filtering most handheld jitter.
 *
 * If the raw delta is large (phone swung hard) we bypass the EMA to
 * avoid the "molasses" feeling when the user turns quickly. See
 * FAST_TRACK_THRESHOLD below.
 */
const EMA_ALPHA = 0.35;
/** Degrees of raw delta above which we snap to the new value instead
 *  of smoothing — keeps the marker in sync during quick rotations. */
const FAST_TRACK_THRESHOLD = 25;

/**
 * Smooth a new angle value against a previous smoothed value using an
 * exponential moving average, taking wrap-around (e.g. 359° → 1°)
 * into account.
 */
function smoothAngle(previous: number, next: number, alpha: number): number {
  // Compute the shortest signed delta on a circle
  let delta = next - previous;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  // Fast-track big rotations so the HUD stays glued to the real cap.
  if (Math.abs(delta) > FAST_TRACK_THRESHOLD) {
    return ((next % 360) + 360) % 360;
  }
  const smoothed = previous + alpha * delta;
  // Normalise back to [0, 360)
  return ((smoothed % 360) + 360) % 360;
}

/**
 * Full device orientation in degrees with smoothing.
 *
 * Exposes the compass heading (0-360°), pitch (front/back tilt) and
 * roll (side tilt), plus an iOS-safe permission flow. Values are
 * filtered through an exponential moving average to avoid the
 * jittering that raw sensor data produces.
 */
export function useDeviceOrientation(): DeviceOrientationState {
  const [heading, setHeading] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [roll, setRoll] = useState(0);
  const [hasCompass, setHasCompass] = useState(false);
  const [permissionState, setPermissionState] = useState<
    "unknown" | "granted" | "denied" | "unsupported"
  >("unknown");

  // Refs keep the latest smoothed values without retriggering renders
  // inside the event handler.
  const headingRef = useRef(0);
  const pitchRef = useRef(0);
  const rollRef = useRef(0);
  const initialisedRef = useRef(false);

  const handleOrientation = useCallback((e: DeviceOrientationEvent) => {
    // Heading: iOS exposes webkitCompassHeading (true compass);
    // Android gives alpha which is inverted relative to compass North.
    const rawHeading =
      (e as DeviceOrientationEvent & { webkitCompassHeading?: number })
        .webkitCompassHeading ??
      (e.alpha !== null ? (360 - e.alpha) % 360 : null);

    const rawPitch = e.beta ?? 0; // -180 .. 180
    const rawRoll = e.gamma ?? 0; // -90 .. 90

    if (rawHeading === null) return;

    if (!initialisedRef.current) {
      headingRef.current = rawHeading;
      pitchRef.current = rawPitch;
      rollRef.current = rawRoll;
      initialisedRef.current = true;
    } else {
      headingRef.current = smoothAngle(headingRef.current, rawHeading, EMA_ALPHA);
      // Pitch and roll don't wrap around in normal phone usage, simple EMA
      pitchRef.current = pitchRef.current + EMA_ALPHA * (rawPitch - pitchRef.current);
      rollRef.current = rollRef.current + EMA_ALPHA * (rawRoll - rollRef.current);
    }

    setHeading(headingRef.current);
    setPitch(pitchRef.current);
    setRoll(rollRef.current);
    setHasCompass(true);
  }, []);

  const attach = useCallback(() => {
    window.addEventListener("deviceorientation", handleOrientation, true);
  }, [handleOrientation]);

  const requestPermission = useCallback(async () => {
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DOE.requestPermission === "function") {
      try {
        const result = await DOE.requestPermission();
        if (result === "granted") {
          setPermissionState("granted");
          attach();
        } else {
          setPermissionState("denied");
        }
      } catch {
        setPermissionState("denied");
      }
    } else {
      setPermissionState("granted");
      attach();
    }
  }, [attach]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof DeviceOrientationEvent === "undefined") {
      setPermissionState("unsupported");
      return;
    }
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DOE.requestPermission !== "function") {
      setPermissionState("granted");
      attach();
    }

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
    };
  }, [attach, handleOrientation]);

  return {
    heading,
    pitch,
    roll,
    hasCompass,
    permissionState,
    requestPermission,
  };
}
