/**
 * INPUT — construction et validation de PipelineInput depuis l'event Inngest.
 *
 * Centralise le mapping payload → input et applique les défauts UNIQUEMENT
 * via CONFIG (pas de magic number ailleurs).
 */

import { CONFIG } from "./config";
import type { PipelineInput } from "./types";

/** Données brutes reçues dans l'event Inngest `game/build.requested`. */
export interface RawEventData {
  slug: string;
  title?: string;
  city: string;
  country?: string;
  themeDescription?: string;
  productDescription?: string;
  narrative?: string;
  difficulty?: number;
  estimatedDurationMin?: number;
  genre?: string;
  language?: string;
  transportMode?: "walking" | "mixed" | "driving";
  radiusKm?: number;
  startPointText?: string;
  startPointLat?: number;
  startPointLon?: number;
  mode?: "city_game" | "city_tour";
  buyerEmail?: string;
  orderId?: string;
  callbackUrl?: string;
  callbackSecret?: string;
  originalPayload?: Record<string, unknown>;
}

/** Construit l'input pipeline à partir des données event + applique les défauts. */
export function buildPipelineInput(data: RawEventData): PipelineInput {
  // Language : normaliser au code ISO 2 lettres
  const rawLang = (data.language ?? "en").toLowerCase().trim();
  const m = rawLang.match(/^([a-z]{2})(?:[-_][a-z0-9]+)?$/);
  const language = m ? m[1] : "en";

  // Transport mode (default walking)
  const transportMode: "walking" | "mixed" | "driving" =
    data.transportMode === "mixed" || data.transportMode === "driving" ? data.transportMode : "walking";

  // Radius : payload first, sinon défaut selon mode
  const radiusKm =
    typeof data.radiusKm === "number" && data.radiusKm > 0
      ? data.radiusKm
      : transportMode === "walking"
        ? CONFIG.WALKING_DEFAULT_RADIUS_KM
        : CONFIG.ROADTRIP_DEFAULT_RADIUS_KM;

  // Start point (validé séparément)
  const startPoint =
    typeof data.startPointLat === "number" && typeof data.startPointLon === "number"
      ? { lat: data.startPointLat, lon: data.startPointLon }
      : undefined;

  return {
    slug: data.slug,
    city: data.city,
    country: data.country,
    theme: data.title ?? data.slug,
    themeDescription: data.themeDescription,
    productDescription: data.productDescription,
    narrative: data.narrative,
    startPoint: startPoint!, // type asserts here, validation immédiate ci-dessous
    startPointText: data.startPointText,
    language,
    transportMode,
    radiusKm,
    genre: data.genre,
    mode: data.mode ?? "city_game",
    estimatedDurationMin: data.estimatedDurationMin ?? 90,
    difficulty: data.difficulty ?? 3,
    buyerEmail: data.buyerEmail,
    orderId: data.orderId,
    callbackUrl: data.callbackUrl,
    callbackSecret: data.callbackSecret,
    originalPayload: data.originalPayload ?? (data as unknown as Record<string, unknown>),
  };
}

/** Throw si startPoint manquant ou invalide. */
export function validateStartPoint(input: PipelineInput): void {
  if (!input.startPoint) {
    throw new Error(
      `[v5 input] startPoint missing for slug=${input.slug} — payload OddballTrip doit fournir startPoint:{lat,lon}`,
    );
  }
  const { lat, lon } = input.startPoint;
  if (typeof lat !== "number" || typeof lon !== "number") {
    throw new Error(`[v5 input] startPoint lat/lon invalides: ${JSON.stringify(input.startPoint)}`);
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error(`[v5 input] startPoint hors range: ${lat},${lon}`);
  }
  if (lat === 0 && lon === 0) {
    throw new Error(`[v5 input] startPoint = null island (0,0)`);
  }
}
