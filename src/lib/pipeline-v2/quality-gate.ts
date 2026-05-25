/**
 * QUALITY GATE — vérifications de qualité avant publication.
 *
 * Politique : on ne publie JAMAIS automatiquement un jeu suspect. Mieux
 * vaut bloquer 1h pour review humain qu'envoyer du contenu fictionnel au
 * client.
 *
 * Checks :
 *   1. Au moins 5 stops géocodés
 *   2. Pas trop de failed geocoding (> 30% → critical)
 *   3. Avertissement Perplexity présent → flag warning
 *   4. Au moins 2 sources/citations Perplexity
 *   5. Tous les stops ont riddle + answer non vides
 *   6. Stops ordonnés cohérents (pas de big jump > 10km consécutif sauf roadtrip)
 *
 * Output : { needsReview: bool, flags: QualityFlag[], reason?: string }
 */

import type {
  DiscoveryResult,
  GeocodeResult,
  PipelineInput,
  QualityFlag,
  StructuredGame,
} from "./types";

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sa = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * R * Math.asin(Math.sqrt(sa));
}

export function runQualityGate(
  input: PipelineInput,
  discovery: DiscoveryResult,
  geocode: GeocodeResult,
  structured: StructuredGame,
): { needsReview: boolean; flags: QualityFlag[]; reason?: string } {
  const flags: QualityFlag[] = [];

  // 1. Stops géocodés minimum
  if (geocode.geocoded.length < 5) {
    flags.push({
      phase: "geocode",
      severity: "critical",
      message: `Only ${geocode.geocoded.length} stops geocoded successfully (min 5 required)`,
    });
  }

  // 2. Failed ratio
  const total = geocode.geocoded.length + geocode.failed.length;
  const failedRatio = total > 0 ? geocode.failed.length / total : 0;
  if (failedRatio > 0.3) {
    flags.push({
      phase: "geocode",
      severity: "critical",
      message: `Geocoding failure rate ${Math.round(failedRatio * 100)}% (${geocode.failed.length}/${total}) — landmark names probably hallucinated or too vague`,
    });
  } else if (failedRatio > 0.1) {
    flags.push({
      phase: "geocode",
      severity: "warning",
      message: `Geocoding failure rate ${Math.round(failedRatio * 100)}% — review the missing landmarks`,
    });
  }

  // 3. Avertissement Perplexity
  if (discovery.warning) {
    flags.push({
      phase: "discovery",
      severity: "warning",
      message: `Perplexity editorial warning: ${discovery.warning.slice(0, 200)}`,
    });
  }

  // 4. Citations
  if (discovery.citations.length < 2) {
    flags.push({
      phase: "discovery",
      severity: "warning",
      message: `Only ${discovery.citations.length} citations from Perplexity — content may be poorly sourced`,
    });
  }

  // 5. Riddles + answers non vides
  for (const stop of structured.stops) {
    if (!stop.riddle || stop.riddle.length < 20) {
      flags.push({
        phase: "structure",
        severity: "critical",
        message: `Stop ${stop.step_order} "${stop.landmarkName}" has no riddle or it's too short`,
      });
    }
    if (!stop.answer || stop.answer.length < 1) {
      flags.push({
        phase: "structure",
        severity: "critical",
        message: `Stop ${stop.step_order} "${stop.landmarkName}" has no answer`,
      });
    }
  }

  // 6. Cohérence géographique : pas de gros sauts si walking mode
  if (input.transportMode !== "driving" && input.transportMode !== "mixed") {
    for (let i = 1; i < structured.stops.length; i++) {
      const prev = structured.stops[i - 1];
      const curr = structured.stops[i];
      const distKm = haversineKm(
        { lat: prev.latitude, lon: prev.longitude },
        { lat: curr.latitude, lon: curr.longitude },
      );
      if (distKm > 5) {
        flags.push({
          phase: "structure",
          severity: "warning",
          message: `Stop ${curr.step_order} is ${distKm.toFixed(1)}km from stop ${prev.step_order} (walking mode — likely too far)`,
        });
      }
    }
  }

  const critical = flags.filter((f) => f.severity === "critical");
  const warnings = flags.filter((f) => f.severity === "warning");

  const needsReview = critical.length > 0 || warnings.length >= 3;
  const reason = needsReview
    ? `${critical.length} critical issue(s), ${warnings.length} warning(s) — manual review required before publication`
    : undefined;

  return { needsReview, flags, reason };
}
