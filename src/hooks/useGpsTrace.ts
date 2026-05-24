"use client";

import { useEffect, useRef } from "react";

/**
 * useGpsTrace
 *
 * Buffer en mémoire les positions GPS du joueur pendant une session,
 * et POST batch vers /api/game/[sessionId]/trace toutes les CAPTURE_MS.
 *
 * Pourquoi un buffer + batch (vs POST direct chaque sample) :
 *   - 1 sample / 30 sec × 2h de jeu = 240 POST → spam serveur
 *   - 4 samples batch / 60 sec = 120 POST → 2× moins
 *   - Sur connexion lente, le batch tolère mieux les pertes
 *
 * Fréquences :
 *   - Sample : tous les 30 sec (assez pour reconstituer une trajectoire
 *     marchée sans saturer le device GPS)
 *   - Flush : toutes les 60 sec (= 2 samples typiques)
 *   - Flush forcé : à l'unmount (joueur ferme l'app ou termine)
 *
 * Désactivation : si props.enabled = false, le hook ne fait RIEN.
 * Utile pour les tests ou si on veut une feature flag.
 */

interface UseGpsTraceParams {
  sessionId: string;
  /** Si false, le hook est en standby (aucun POST). */
  enabled: boolean;
  /** Position courante du joueur (null si GPS pas encore fix). */
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  /** step_order actif au moment de la capture (pour segmenter le tracé). */
  currentStep: number | null;
}

const CAPTURE_INTERVAL_MS = 30_000; // capture toutes les 30 sec
const FLUSH_INTERVAL_MS = 60_000; // flush toutes les 60 sec
const MAX_BUFFER = 50; // garde-fou anti-mémoire

interface Sample {
  lat: number;
  lon: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  step: number | null;
  t: number; // Date.now()
}

export function useGpsTrace({
  sessionId,
  enabled,
  latitude,
  longitude,
  accuracy,
  heading,
  speed,
  currentStep,
}: UseGpsTraceParams) {
  const bufferRef = useRef<Sample[]>([]);
  const lastCaptureRef = useRef<number>(0);
  // Refs des props pour capturer la dernière valeur dans les intervals
  // sans devoir re-créer les intervals à chaque changement de position.
  const latRef = useRef(latitude);
  const lonRef = useRef(longitude);
  const accRef = useRef(accuracy);
  const headRef = useRef(heading);
  const spdRef = useRef(speed);
  const stepRef = useRef(currentStep);
  useEffect(() => {
    latRef.current = latitude;
    lonRef.current = longitude;
    accRef.current = accuracy;
    headRef.current = heading;
    spdRef.current = speed;
    stepRef.current = currentStep;
  }, [latitude, longitude, accuracy, heading, speed, currentStep]);

  // ── Capture loop : toutes les 30 sec, snapshot la position courante ──
  useEffect(() => {
    if (!enabled || !sessionId) return;
    const captureIv = setInterval(() => {
      const now = Date.now();
      // Skip si pas de fix GPS
      if (latRef.current === null || lonRef.current === null) return;
      // Anti-doublon : si déjà capturé < CAPTURE_INTERVAL_MS - 5s
      if (now - lastCaptureRef.current < CAPTURE_INTERVAL_MS - 5_000) return;
      lastCaptureRef.current = now;
      bufferRef.current.push({
        lat: latRef.current,
        lon: lonRef.current,
        accuracy: accRef.current,
        heading: headRef.current,
        speed: spdRef.current,
        step: stepRef.current,
        t: now,
      });
      // Cap à MAX_BUFFER (au cas où le flush échoue plusieurs fois)
      if (bufferRef.current.length > MAX_BUFFER) {
        bufferRef.current = bufferRef.current.slice(-MAX_BUFFER);
      }
    }, CAPTURE_INTERVAL_MS / 2); // tick toutes les 15s, capture si >=30s écoulées
    return () => clearInterval(captureIv);
  }, [enabled, sessionId]);

  // ── Flush loop : POST le buffer toutes les 60 sec ──
  const flushNow = (useBeacon = false): boolean => {
    if (bufferRef.current.length === 0) return false;
    const samples = bufferRef.current;
    bufferRef.current = [];
    const url = `/api/game/${sessionId}/trace`;
    const body = JSON.stringify({ samples });
    if (
      useBeacon &&
      typeof navigator !== "undefined" &&
      "sendBeacon" in navigator
    ) {
      // Sendbeacon : tolère le unload de la page (joueur ferme onglet).
      try {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(url, blob);
        return true;
      } catch {
        /* fall through to fetch */
      }
    }
    // Best-effort POST. Pas de await — fire-and-forget pour pas bloquer
    // l'UI. En cas d'échec on perd ces samples (acceptable).
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Silent fail — re-empile dans le buffer pour retry au prochain flush
      bufferRef.current = [...samples, ...bufferRef.current].slice(
        -MAX_BUFFER,
      );
    });
    return true;
  };

  useEffect(() => {
    if (!enabled || !sessionId) return;
    const flushIv = setInterval(() => flushNow(false), FLUSH_INTERVAL_MS);
    // Flush au unmount (joueur termine ou navigue ailleurs)
    return () => {
      clearInterval(flushIv);
      flushNow(true);
    };
  }, [enabled, sessionId]);

  // ── Flush sur beforeunload (joueur ferme l'onglet en cours de jeu) ──
  useEffect(() => {
    if (!enabled || !sessionId) return;
    const onUnload = () => flushNow(true);
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId]);
}
