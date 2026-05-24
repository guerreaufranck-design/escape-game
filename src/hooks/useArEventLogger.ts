"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * useArEventLogger
 *
 * Logger d'événements AR avec buffer + batch POST.
 * Pattern proche de useGpsTrace mais events plus rares (typiquement 5-20
 * par session) et envoyés au fil de l'eau dans des batches courts.
 *
 * Usage :
 *   const logAr = useArEventLogger(sessionId);
 *   logAr("ar_open", { step: 3 });
 *   logAr("ar_lock_on", { step: 3, distance: 42, angleDeg: 8 });
 *
 * Comportement :
 *   - Empile l'event en buffer (in-memory)
 *   - Flush dans 5 sec OU dès que le buffer atteint 5 events
 *   - Flush forcé sur unmount via sendBeacon
 *
 * Si sessionId est null/empty → no-op silencieux (utile pendant le
 * chargement initial où sessionId n'est pas encore résolu).
 */

export type ArEventType =
  | "ar_open"
  | "ar_camera_ready"
  | "ar_camera_denied"
  | "ar_compass_granted"
  | "ar_compass_denied"
  | "ar_lock_on"
  | "ar_facade_revealed"
  | "ar_character_speak"
  | "ar_auto_validated"
  | "ar_manual_validated"
  | "ar_close";

interface Event {
  type: ArEventType;
  step?: number | null;
  meta?: Record<string, unknown>;
  t: number;
}

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_THRESHOLD = 5;
const MAX_BUFFER = 30;

export function useArEventLogger(sessionId: string | null | undefined) {
  const bufferRef = useRef<Event[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(
    (useBeacon = false): boolean => {
      if (!sessionId) return false;
      if (bufferRef.current.length === 0) return false;
      const events = bufferRef.current;
      bufferRef.current = [];
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const url = `/api/game/${sessionId}/ar-event`;
      const body = JSON.stringify({ events });
      if (useBeacon && typeof navigator !== "undefined" && "sendBeacon" in navigator) {
        try {
          const blob = new Blob([body], { type: "application/json" });
          navigator.sendBeacon(url, blob);
          return true;
        } catch {
          /* fallthrough */
        }
      }
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {
        // Re-empile pour retry au prochain flush
        bufferRef.current = [...events, ...bufferRef.current].slice(-MAX_BUFFER);
      });
      return true;
    },
    [sessionId],
  );

  const logAr = useCallback(
    (type: ArEventType, opts?: { step?: number | null; meta?: Record<string, unknown> }) => {
      if (!sessionId) return;
      bufferRef.current.push({
        type,
        step: opts?.step ?? null,
        meta: opts?.meta,
        t: Date.now(),
      });
      if (bufferRef.current.length > MAX_BUFFER) {
        bufferRef.current = bufferRef.current.slice(-MAX_BUFFER);
      }
      // Flush threshold immédiat
      if (bufferRef.current.length >= FLUSH_THRESHOLD) {
        flush(false);
        return;
      }
      // Sinon démarre un timer pour flush différé
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          flush(false);
        }, FLUSH_INTERVAL_MS);
      }
    },
    [sessionId, flush],
  );

  // Flush sur unmount + beforeunload
  useEffect(() => {
    const onUnload = () => flush(true);
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", onUnload);
      window.addEventListener("pagehide", onUnload);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", onUnload);
        window.removeEventListener("pagehide", onUnload);
      }
      flush(true);
    };
  }, [flush]);

  return logAr;
}
