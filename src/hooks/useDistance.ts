"use client";

import { useMemo } from "react";
import { haversineDistance, calculateBearing } from "@/lib/geo";

interface UseDistanceParams {
  playerLat: number | null;
  playerLon: number | null;
  targetLat: number | null;
  targetLon: number | null;
}

export function useDistance({
  playerLat,
  playerLon,
  targetLat,
  targetLon,
}: UseDistanceParams) {
  const distance = useMemo(() => {
    if (
      playerLat === null ||
      playerLon === null ||
      targetLat === null ||
      targetLon === null
    )
      return null;

    return haversineDistance(playerLat, playerLon, targetLat, targetLon);
  }, [playerLat, playerLon, targetLat, targetLon]);

  const bearing = useMemo(() => {
    if (
      playerLat === null ||
      playerLon === null ||
      targetLat === null ||
      targetLon === null
    )
      return null;

    return calculateBearing(playerLat, playerLon, targetLat, targetLon);
  }, [playerLat, playerLon, targetLat, targetLon]);

  return { distance, bearing };
}
