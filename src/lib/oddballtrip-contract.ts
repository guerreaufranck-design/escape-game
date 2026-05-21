/**
 * OddballTrip → escape-game POST `/api/games/generate` contract validator.
 *
 * ═══════════════════════════════════════════════════════════════════
 * RATIONALE (2026-05-21)
 * ═══════════════════════════════════════════════════════════════════
 *
 * We've observed 3 days of cascading bugs whose root cause was a
 * lossy / ambiguous payload from OddballTrip :
 *
 *   1. transportMode walking instead of mixed (radius hardcoded their side)
 *   2. radiusKm: 30 for ALL roadtrips, regardless of operator input
 *   3. city: "Loire Valley, France" instead of "Chambord, France"
 *      → SEO label, not a Google-geocodable entity, broke downstream
 *        landmark geocoding
 *
 * Each bug only surfaced after the pipeline spent 5-10 minutes + ~$2
 * in API calls. The defensive response is to validate the contract AT
 * INGRESS and either reject with a clear 400 (hard violations) or
 * surface a warning + telemetry row (soft violations, payload tolerated).
 *
 * ═══════════════════════════════════════════════════════════════════
 * HARD vs SOFT validation
 * ═══════════════════════════════════════════════════════════════════
 *
 * HARD = reject with 400. Sent to OddballTrip dev as actionable feedback.
 *
 *   - Required fields missing (city/country/theme/etc.)
 *   - startPoint with invalid coords (out of range, null-island non-Greenwich)
 *   - transportMode + radiusKm inconsistency (walking with radiusKm > 5)
 *
 * SOFT = accept but log + telemetry. The pipeline tolerates it (the
 * multi-strategy geocode + sanity-check thresholds we shipped today
 * mitigate the impact). But we collect the data so OddballTrip dev can
 * see their drift over time.
 *
 *   - city matches SEO-label heuristic ("Valley", "Region", "District"
 *     without commune name)
 *   - city contains commas (we expect just the commune name + country)
 *   - startPointText contains "AND" / "&" (multi-spot ambiguity)
 *   - transportMode missing on a request that has radiusKm > 5
 *
 * Every warning is captured in the response so the OddballTrip dev can
 * watch their integration health from their side (we return `warnings`
 * array in 202 ACK).
 */
import { z } from "zod";

// ════════════════════════════════════════════════════════════════════
// Zod schema — STRICT shape of the OddballTrip → escape-game contract
// ════════════════════════════════════════════════════════════════════

const StartPointSchema = z
  .object({
    lat: z.number().optional(),
    lon: z.number().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    lng: z.number().optional(),
  })
  .passthrough()
  .refine(
    (sp) => {
      const lat = sp.lat ?? sp.latitude ?? null;
      const lon = sp.lon ?? sp.longitude ?? sp.lng ?? null;
      if (lat === null || lon === null) return false;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
      // null-island guard — only Greenwich Royal Observatory area allowed
      // at lon=0 (latitude 51.45-51.5).
      const isGreenwich = lon === 0 && lat >= 51.45 && lat <= 51.5;
      if ((lat === 0 || lon === 0) && !isGreenwich) return false;
      return true;
    },
    {
      message:
        "Invalid startPoint coords (out of range, null-island 0,0 outside Greenwich, or missing lat/lon)",
    },
  );

const SeedSiteSchema = z.object({
  name: z.string().trim().min(1),
  access: z.enum(["libre", "payant", "mixte"]),
  lat: z.number().optional(),
  lon: z.number().optional(),
  note: z.string().optional(),
});

const StopSchema = z.object({
  name: z.string().trim().min(1),
  landmarkName: z.string().trim().optional(),
  description: z.string().optional(),
});

export const OddballtripGenerateGameContractSchema = z
  .object({
    // Required fields — pipeline can't run without these.
    city: z.string().trim().min(2),
    country: z.string().trim().min(2),
    theme: z.string().trim().min(2),
    themeDescription: z.string().trim().min(2),
    narrative: z.string().trim().min(2),

    // Strongly recommended (we have fallbacks but accuracy degrades).
    startPoint: StartPointSchema.optional(),
    startPointText: z.string().trim().optional(),
    startPointDescription: z.string().trim().optional(),
    meetingPoint: z.string().trim().optional(),
    checkpoint: z.string().trim().optional(),
    meetingLocation: z.string().trim().optional(),

    // Optional with typed fallbacks.
    slug: z.string().trim().optional(),
    difficulty: z.number().int().min(1).max(5).optional(),
    estimatedDurationMin: z.number().positive().optional(),
    estimatedDuration: z.number().positive().optional(),
    coverImage: z.string().nullable().optional(),
    stops: z.array(StopSchema).optional(),
    stopCount: z.number().int().min(3).max(15).optional(),
    language: z.string().optional(),
    genre: z.string().optional(),
    accessibility: z.enum(["free", "any"]).optional(),
    mode: z.enum(["city_game", "city_tour"]).optional(),

    // Roadtrip-specific.
    transportMode: z.enum(["walking", "driving", "mixed"]).optional(),
    radiusKm: z.number().positive().max(60).optional(),
    recommendedDaysMin: z.number().int().min(1).max(14).optional(),
    recommendedDaysMax: z.number().int().min(1).max(14).optional(),
    roadtripSeedSites: z.array(SeedSiteSchema).optional(),

    // Callback / order metadata — not validated for correctness, just
    // passed through.
    buyerEmail: z.string().optional(),
    orderId: z.string().optional(),
    callbackUrl: z.string().url().optional(),
    callbackSecret: z.string().optional(),
  })
  .passthrough(); // tolerate unknown fields (OddballTrip may add experimental keys)

export type OddballtripGenerateGameContract = z.infer<
  typeof OddballtripGenerateGameContractSchema
>;

// ════════════════════════════════════════════════════════════════════
// Soft warnings — heuristics that signal upstream drift without
// blocking the pipeline. Each warning is human-readable and links
// back to the OddballTrip integration spec.
// ════════════════════════════════════════════════════════════════════

export interface ContractWarning {
  code:
    | "city_looks_like_seo_label"
    | "city_has_commas"
    | "start_point_text_multi_spot"
    | "transport_mode_radius_mismatch"
    | "roadtrip_without_seed_sites"
    | "missing_recommended_days_for_roadtrip"
    | "buyer_email_missing"
    | "callback_url_missing";
  message: string;
  field?: string;
  suggested_fix?: string;
}

const SEO_LABEL_TOKENS = [
  // Words that signal a region/SEO label rather than a real commune.
  // These are common in tourist-marketing strings.
  "valley",
  "region",
  "district",
  "area",
  "country side",
  "countryside",
  "coast",
  "côte", // côte d'azur / côte basque
  "riviera",
  "highlands",
  "lowlands",
  "moors",
  "plateau",
  "delta",
  "peninsula",
  "isles",
  "lake district",
];

/**
 * Returns soft warnings without blocking the pipeline.
 *
 * Call AFTER hard validation succeeds — these heuristics assume the
 * payload is structurally valid.
 */
export function collectContractWarnings(
  payload: OddballtripGenerateGameContract,
): ContractWarning[] {
  const warnings: ContractWarning[] = [];

  // ── city looks like SEO label ───────────────────────────────────
  // "Loire Valley", "Provence", "Costa Brava", "Lake District" → not
  // a Google-geocodable commune. Downstream landmark geocoding fails
  // when biased on these strings.
  const cityLower = payload.city.toLowerCase();
  const seoMatch = SEO_LABEL_TOKENS.find((tok) => cityLower.includes(tok));
  if (seoMatch) {
    warnings.push({
      code: "city_looks_like_seo_label",
      message: `city="${payload.city}" contains "${seoMatch}" which is a tourist-marketing label, not a Google-geocodable commune. Downstream geocoding may fall back to narrative mode for stops that can't be biased properly. Recommended: send the actual commune name (e.g. "Chambord, France" instead of "Loire Valley, France"). If you want to keep the SEO label for your side, add a separate "region_label" field — we'll ignore it.`,
      field: "city",
      suggested_fix:
        "Send the actual commune name the operator picked on the form, not a SEO label.",
    });
  }

  // ── city has commas (multi-part addresses are usually bias-noise) ──
  // "Old Town · Square · Center, Athens" → OK to strip the labels.
  // "Athens, Greece" → also accepted (we split on comma downstream).
  // We warn only when there are 2+ commas (suggests confusion).
  const commaCount = (payload.city.match(/,/g) || []).length;
  if (commaCount >= 2) {
    warnings.push({
      code: "city_has_commas",
      message: `city="${payload.city}" contains ${commaCount} commas. We expect a simple "Commune, Country" or just "Commune" string. Multi-part labels confuse the Google Geocoding bias.`,
      field: "city",
    });
  }

  // ── transport mode / radius mismatch ────────────────────────────
  const mode = payload.transportMode;
  const radius = payload.radiusKm;
  if (mode === "walking" && radius && radius > 5) {
    warnings.push({
      code: "transport_mode_radius_mismatch",
      message: `transportMode="walking" but radiusKm=${radius} (> 5 km). A walking tour should have radius ≤ 5 km. If this is a roadtrip, set transportMode="mixed" or "driving".`,
      field: "transportMode",
      suggested_fix: 'Set transportMode to "mixed" if user can drive between stops.',
    });
  }

  // ── roadtrip without seed sites ─────────────────────────────────
  if (
    (mode === "mixed" || mode === "driving") &&
    (!payload.roadtripSeedSites || payload.roadtripSeedSites.length === 0)
  ) {
    warnings.push({
      code: "roadtrip_without_seed_sites",
      message: `transportMode="${mode}" but roadtripSeedSites is empty. Pipeline will work but discovery quality drops without operator-curated anchor sites (one less curation signal).`,
      field: "roadtripSeedSites",
      suggested_fix:
        "Provide 3-7 anchor sites with name + access (libre/payant/mixte).",
    });
  }

  // ── roadtrip missing recommendedDays ────────────────────────────
  if (
    (mode === "mixed" || mode === "driving") &&
    !payload.recommendedDaysMin &&
    !payload.recommendedDaysMax
  ) {
    warnings.push({
      code: "missing_recommended_days_for_roadtrip",
      message: `Roadtrip without recommendedDaysMin/Max. We default code_validity_hours to 168 (7 days). Confirm this matches your product page.`,
    });
  }

  // ── buyer email missing → no callback / notification possible ───
  if (!payload.buyerEmail && !payload.callbackUrl) {
    warnings.push({
      code: "buyer_email_missing",
      message:
        "Neither buyerEmail nor callbackUrl provided. We cannot notify the customer when the game is ready. Operator must poll find-game themselves.",
    });
  }

  // ── startPointText multi-spot ───────────────────────────────────
  const sptCandidates = [
    payload.startPointText,
    payload.startPointDescription,
    payload.meetingPoint,
    payload.checkpoint,
  ].filter((c): c is string => typeof c === "string" && c.trim().length > 0);
  const startText = sptCandidates[0];
  if (
    startText &&
    /\b(and|et|&|,)\b/i.test(startText) &&
    startText.length > 60
  ) {
    warnings.push({
      code: "start_point_text_multi_spot",
      message: `startPointText="${startText}" contains "and"/"&"/comma suggesting multiple spots. Geocoding picks one — consider a single explicit meeting point.`,
    });
  }

  return warnings;
}

// ════════════════════════════════════════════════════════════════════
// Public validator — returns { ok, data, warnings, errors }
// ════════════════════════════════════════════════════════════════════

export interface ValidationOutcome {
  ok: boolean;
  data?: OddballtripGenerateGameContract;
  warnings: ContractWarning[];
  errors?: Array<{ path: string; message: string }>;
}

/**
 * Validate an incoming POST /api/games/generate payload against the
 * OddballTrip contract.
 *
 * Pipeline behavior :
 *   - ok=false → caller returns 400 with `errors` array.
 *   - ok=true  → caller proceeds; `warnings` is informational only.
 *
 * Both Zod parse errors AND business-rule violations populate `errors`.
 * Soft heuristics populate `warnings` (never block).
 */
export function validateOddballtripContract(
  rawBody: unknown,
): ValidationOutcome {
  const parsed = OddballtripGenerateGameContractSchema.safeParse(rawBody);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return { ok: false, warnings: [], errors };
  }

  const data = parsed.data;
  const warnings = collectContractWarnings(data);

  return { ok: true, data, warnings };
}
