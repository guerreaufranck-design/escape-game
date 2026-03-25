"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { GEO_OPTIONS } from "@/lib/constants";

interface GeolocationState {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  error: string | null;
  isTracking: boolean;
  timestamp: number | null;
}

const initialState: GeolocationState = {
  latitude: null,
  longitude: null,
  accuracy: null,
  heading: null,
  speed: null,
  error: null,
  isTracking: false,
  timestamp: null,
};

export function useGeolocation(autoStart = false) {
  const [state, setState] = useState<GeolocationState>(initialState);
  const watchIdRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const throttleMs = 1000;

  const handleSuccess = useCallback((position: GeolocationPosition) => {
    const now = Date.now();
    if (now - lastUpdateRef.current < throttleMs) return;
    lastUpdateRef.current = now;

    setState((prev) => ({
      ...prev,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      heading: position.coords.heading,
      speed: position.coords.speed,
      error: null,
      isTracking: true,
      timestamp: position.timestamp,
    }));
  }, []);

  const handleError = useCallback((error: GeolocationPositionError) => {
    let message = "Erreur de geolocalisation";
    switch (error.code) {
      case error.PERMISSION_DENIED:
        message = "L'acces a la geolocalisation a ete refuse";
        break;
      case error.POSITION_UNAVAILABLE:
        message = "Position indisponible";
        break;
      case error.TIMEOUT:
        message = "Delai d'attente de la position depasse";
        break;
    }
    setState((prev) => ({ ...prev, error: message, isTracking: false }));
  }, []);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setState((prev) => ({
        ...prev,
        error: "La geolocalisation n'est pas supportee par votre navigateur",
      }));
      return;
    }

    // Clear any existing watch before restarting
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      GEO_OPTIONS
    );
    setState((prev) => ({ ...prev, isTracking: true, error: null }));
  }, [handleSuccess, handleError]);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setState((prev) => ({ ...prev, isTracking: false }));
  }, []);

  useEffect(() => {
    if (autoStart) {
      startTracking();
    }
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [autoStart, startTracking]);

  return { ...state, startTracking, stopTracking };
}
