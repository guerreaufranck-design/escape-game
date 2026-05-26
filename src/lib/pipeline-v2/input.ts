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

  // Start point — V5 (2026-05-26) : peut être :
  //   (a) GPS lat/lon (legacy / payload OddballTrip ancien)
  //   (b) startPointText seul (nouveau flux OddballTrip — on géocode dans
  //       l'étape resolve-start de la pipeline)
  // Si ni (a) ni (b), validateStartPoint() throw plus bas.
  const startPoint =
    typeof data.startPointLat === "number" && typeof data.startPointLon === "number"
      ? { lat: data.startPointLat, lon: data.startPointLon }
      : { lat: 0, lon: 0 }; // placeholder — sera remplacé par resolve-start

  return {
    slug: data.slug,
    city: data.city,
    country: data.country,
    theme: data.title ?? data.slug,
    themeDescription: data.themeDescription,
    productDescription: data.productDescription,
    narrative: data.narrative,
    startPoint, // si placeholder (0,0), la pipeline va le résoudre via startPointText
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

/**
 * Throw si AUCUNE source de startPoint n'est fournie.
 *
 * V5 (2026-05-26) accepte deux entrées :
 *   (a) GPS lat/lon valides (legacy)
 *   (b) startPointText non vide (nouveau flux OddballTrip — texte type
 *       "Notre Dame de Paris - Paris", à géocoder dans l'étape resolve-start)
 *
 * Si (a) absent ET (b) absent → throw. Si (a) absent et (b) présent, on
 * laisse les coords à (0,0) — l'étape resolve-start de la pipeline va
 * géocoder le texte avant tout autre usage.
 */
export function validateStartPoint(input: PipelineInput): void {
  const hasGps =
    input.startPoint &&
    typeof input.startPoint.lat === "number" &&
    typeof input.startPoint.lon === "number" &&
    !(input.startPoint.lat === 0 && input.startPoint.lon === 0) &&
    input.startPoint.lat >= -90 &&
    input.startPoint.lat <= 90 &&
    input.startPoint.lon >= -180 &&
    input.startPoint.lon <= 180;

  const hasText =
    typeof input.startPointText === "string" && input.startPointText.trim().length > 0;

  if (!hasGps && !hasText) {
    throw new Error(
      `[v5 input] startPoint missing for slug=${input.slug} — OddballTrip doit fournir SOIT startPointLat/Lon, SOIT startPointText (ex: "Notre Dame de Paris - Paris")`,
    );
  }

  // Si GPS fourni mais hors range, on rejette
  if (input.startPoint && !hasGps && !hasText) {
    const { lat, lon } = input.startPoint;
    throw new Error(`[v5 input] startPoint GPS invalides: ${lat},${lon}`);
  }
}

/** Indique si le startPoint doit être résolu via géocodage textuel.
 *  Vrai si on n'a pas de GPS valide mais qu'on a un texte. */
export function shouldResolveStartFromText(input: PipelineInput): boolean {
  const hasValidGps =
    input.startPoint &&
    !(input.startPoint.lat === 0 && input.startPoint.lon === 0) &&
    typeof input.startPoint.lat === "number" &&
    typeof input.startPoint.lon === "number";
  const hasText =
    typeof input.startPointText === "string" && input.startPointText.trim().length > 0;
  return !hasValidGps && hasText;
}
