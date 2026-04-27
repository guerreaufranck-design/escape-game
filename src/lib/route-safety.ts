/**
 * Walking-route safety checks for the generation pipeline.
 *
 * The field test surfaced a step that required the player to cross a
 * multi-lane road with traffic. We can't fully prove "no dangerous
 * crossing" without paid routing data, but we can catch the worst
 * offenders cheaply:
 *
 *  1. Straight-line distance between consecutive stops > 800m
 *     (typical comfortable walking budget for a tourism game is
 *      < 800m / ~10 min per leg)
 *  2. Walking-route detour ratio > 1.6 (the OSRM walking route is
 *     much longer than the as-the-crow-flies distance — usually
 *     means the walker had to go around a barrier: highway, river,
 *     train tracks, big roundabout)
 *
 * OSRM is queried via its free public endpoint (project-osrm.org).
 * No API key needed. Times out at 4s per leg so a slow response
 * doesn't stall the pipeline.
 */

import { haversineDistance } from "./geo";

export interface RouteCheck {
  /** Direct GPS distance, in metres */
  straightDistanceM: number;
  /** Walking route length per OSRM, in metres (null if OSRM didn't answer) */
  walkingDistanceM: number | null;
  /** walkingDistance / straightDistance — null if OSRM didn't answer */
  detourRatio: number | null;
  /** Verdict — false means "this leg looks risky, the player may need to
   *  cross a big road or take a long detour". The caller can choose to
   *  warn / regenerate / swap stops. */
  ok: boolean;
  /** Human-readable reasons (English, logged not displayed) */
  reasons: string[];
}

const MAX_STRAIGHT_DISTANCE_M = 800;
const MAX_DETOUR_RATIO = 1.6;
const OSRM_TIMEOUT_MS = 4000;

/**
 * Query OSRM's public walking router. Returns route distance in metres,
 * or null on any failure (timeout, network, malformed response). Never
 * throws — the pipeline must keep running even if OSRM is down.
 */
async function fetchWalkingDistance(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): Promise<number | null> {
  const url = `https://router.project-osrm.org/route/v1/foot/${fromLon},${fromLat};${toLon},${toLat}?overview=false`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      routes?: Array<{ distance?: number }>;
    };
    return data?.routes?.[0]?.distance ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check a single walking leg between two points.
 */
export async function checkWalkingLeg(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): Promise<RouteCheck> {
  const straight = haversineDistance(fromLat, fromLon, toLat, toLon);
  const walking = await fetchWalkingDistance(fromLat, fromLon, toLat, toLon);
  const ratio = walking !== null && straight > 0 ? walking / straight : null;

  const reasons: string[] = [];
  let ok = true;

  if (straight > MAX_STRAIGHT_DISTANCE_M) {
    ok = false;
    reasons.push(
      `straight-line distance ${Math.round(straight)}m exceeds ${MAX_STRAIGHT_DISTANCE_M}m`,
    );
  }
  if (ratio !== null && ratio > MAX_DETOUR_RATIO) {
    ok = false;
    reasons.push(
      `OSRM detour ratio ${ratio.toFixed(2)} > ${MAX_DETOUR_RATIO} (likely barrier: highway, river, train tracks)`,
    );
  }

  return {
    straightDistanceM: Math.round(straight),
    walkingDistanceM: walking !== null ? Math.round(walking) : null,
    detourRatio: ratio !== null ? Number(ratio.toFixed(2)) : null,
    ok,
    reasons,
  };
}

/**
 * Check every consecutive leg in an ordered list of stops.
 * Returns one RouteCheck per leg. If `ok` is false on any leg, the caller
 * should reorder, swap, or warn.
 */
export async function checkWalkingRoute(
  stops: Array<{ latitude: number; longitude: number }>,
): Promise<{
  legs: RouteCheck[];
  totalStraightM: number;
  totalWalkingM: number | null;
  allOk: boolean;
}> {
  if (stops.length < 2) {
    return { legs: [], totalStraightM: 0, totalWalkingM: 0, allOk: true };
  }

  // Run leg checks in parallel — typically 4-7 legs, OSRM handles them.
  const legPromises: Array<Promise<RouteCheck>> = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    legPromises.push(
      checkWalkingLeg(a.latitude, a.longitude, b.latitude, b.longitude),
    );
  }
  const legs = await Promise.all(legPromises);

  const totalStraightM = legs.reduce((s, l) => s + l.straightDistanceM, 0);
  const haveAllWalking = legs.every((l) => l.walkingDistanceM !== null);
  const totalWalkingM = haveAllWalking
    ? legs.reduce((s, l) => s + (l.walkingDistanceM ?? 0), 0)
    : null;

  const allOk = legs.every((l) => l.ok);
  return { legs, totalStraightM, totalWalkingM, allOk };
}
