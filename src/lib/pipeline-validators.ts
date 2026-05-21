/**
 * Pipeline validators — Pre-publish quality gates.
 *
 * Tourne en FIN de pipeline, après que game + steps + audios + translations
 * soient tous insérés en DB. Détecte les 5 classes de bugs observés en
 * prod et flag `needs_review=true` si l'un est rencontré, pour qu'oddballtrip
 * retienne le code activation jusqu'à inspection humaine.
 *
 * Pourquoi un validator centralisé plutôt que 5 fixes éparpillés :
 * chaque bug observé (twin stops Lugdunum V2 26m, Roman drift Step 2
 * 1477 vs 177 AD, translation incomplete 32/34 fields, audio coverage
 * 17/19) appartient à une classe générique qu'on peut détecter par
 * analyse de l'état final. Plutôt que de prévenir chaque bug à sa
 * source (complexe, fragile), on les détecte tous d'un coup à la fin.
 *
 * Cycle attendu :
 *   Pipeline génère → Validate → si KO needs_review=true + email
 *   → opérateur inspecte → soit edit-step + release-game,
 *      soit wipe + regenerate
 *   → JAMAIS de jeu cassé reçu par un client
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { WEAK_ANSWERS, KNOWN_FAKE_TOKENS } from "@/lib/answer-blacklists";
import { geocodeLocation } from "@/lib/geocode";

/** Une issue détectée par le validator. */
export interface ValidationIssue {
  /** Code machine-parseable. */
  code:
    | "twin_stops"
    | "below_floor"
    | "roman_date_drift"
    | "translation_incomplete"
    | "audio_coverage_mismatch"
    // Added 2026-05-17 (B2 pre-publish validator extensions) :
    | "duplicate_indice"
    | "weak_indice"
    | "fake_indice"
    | "weak_final"
    | "fake_final"
    | "ar_diversity_low"
    | "gps_out_of_cluster"
    | "sources_thin"
    | "missing_final_explanation"
    // Added 2026-05-17 (B3 GPS cross-validation) :
    | "gps_cross_check_drift";
  /** Message humain pour l'email d'alerte. */
  message: string;
  /** Détails techniques pour debug. */
  details?: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Texte concaténé prêt pour `games.review_reason`. */
  reviewReason: string;
}

/**
 * Distance haversine entre deux points lat/lon, en mètres.
 * Local helper pour ne pas dépendre de `geocode.ts` (cycle d'import potentiel).
 */
function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

/**
 * Décode un chiffre romain (MDCLXVI) en entier décimal. Retourne null
 * si la chaîne contient des caractères non-romains (ex: LUGUS, VERITAS).
 * Tolérant aux espaces et casse mixte.
 */
function decodeRoman(s: string): number | null {
  const clean = s.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[MDCLXVI]+$/.test(clean)) return null;
  const map: Record<string, number> = {
    M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1,
  };
  let result = 0;
  for (let i = 0; i < clean.length; i++) {
    const cur = map[clean[i]];
    const next = map[clean[i + 1]];
    if (next && cur < next) result -= cur;
    else result += cur;
  }
  return result > 0 ? result : null;
}

/**
 * Extrait toutes les dates mentionnées dans un texte (riddle + anecdote).
 * Retourne un array d'entiers — positifs pour AD, négatifs pour BC.
 *
 * Patterns couverts :
 *   - "43 BC" / "43 av. J.-C." / "43 BCE"
 *   - "177 AD" / "177 ap. J.-C." / "177 CE"
 *   - "in 1416" / "depuis 1492" / "since 1500" (years 100-2200 standalone)
 *   - Évite les faux positifs sur "8 stops", "30 m" via les keywords
 */
function extractDates(text: string): number[] {
  const dates: number[] = [];
  if (!text) return dates;

  // AD / CE / ap. J.-C.
  const adPattern = /(\d{1,4})\s*(?:AD|CE|ap\.?\s*J\.?-?C\.?)/gi;
  for (const m of text.matchAll(adPattern)) {
    const year = parseInt(m[1], 10);
    if (year > 0 && year < 2200) dates.push(year);
  }

  // BC / BCE / av. J.-C.
  const bcPattern = /(\d{1,4})\s*(?:BC|BCE|av\.?\s*J\.?-?C\.?)/gi;
  for (const m of text.matchAll(bcPattern)) {
    const year = parseInt(m[1], 10);
    if (year > 0 && year < 5000) dates.push(-year);
  }

  // Standalone years preceded by a temporal keyword (3-4 digits, year-range)
  const standalonePattern =
    /\b(?:in|since|by|de|en|depuis|année|year|year-of)\s+(\d{3,4})\b/gi;
  for (const m of text.matchAll(standalonePattern)) {
    const year = parseInt(m[1], 10);
    if (year >= 100 && year <= 2200) dates.push(year);
  }

  return dates;
}

/**
 * Validator final post-pipeline. Tourne après `prepareGamePackage` pour
 * avoir une vue complète game + steps + audios + translations.
 */
/**
 * Options de validation.
 *
 * `skipCrossValidation` : désactive le check B3 (`gps_cross_check_drift`)
 * qui fait 8 appels Google Places par run à $0.024. Indispensable quand le
 * validator est appelé en boucle par `finalizeGame` (auto-repair loop) :
 * sans ce flag, on brûle ~$0.20 de Google par itération inutile (les coords
 * ne changent pas entre 2 validations consécutives sur le même game).
 *
 * Politique :
 *   - 1ère validation de la pipeline initiale : skipCrossValidation=false
 *     (on VEUT le check définitif)
 *   - Toutes les validations subséquentes (finalizeGame, cron re-run) :
 *     skipCrossValidation=true (on a déjà la donnée)
 */
export interface ValidateOptions {
  skipCrossValidation?: boolean;
}

export async function validateFinalGame(
  gameId: string,
  language: string | undefined,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  const supabase = createAdminClient();
  const issues: ValidationIssue[] = [];

  // 1. Fetch game + steps
  const { data: game, error: gameErr } = await supabase
    .from("games")
    .select(
      "id, slug, title, mode, transport_mode, radius_km, final_answer, final_answer_explanation, city",
    )
    .eq("id", gameId)
    .single();
  if (gameErr || !game) {
    return {
      ok: false,
      issues: [
        {
          code: "below_floor",
          message: `Game ${gameId} not found in DB`,
        },
      ],
      reviewReason: `Validator failed to fetch game ${gameId}`,
    };
  }

  const { data: steps } = await supabase
    .from("game_steps")
    .select(
      "id, step_order, title, landmark_name, latitude, longitude, riddle_text, anecdote, ar_facade_text, answer_text, ar_character_type, poi_category, landmark_citation",
    )
    .eq("game_id", gameId)
    .order("step_order");

  if (!steps || steps.length === 0) {
    return {
      ok: false,
      issues: [{ code: "below_floor", message: "No steps in DB" }],
      reviewReason: "No steps found",
    };
  }

  // 2. Floor strict : minimum 6 stops
  if (steps.length < 6) {
    issues.push({
      code: "below_floor",
      message: `${steps.length} stops in DB — below the commercial floor of 6. Operator must reframe the fiche editorially.`,
      details: { stopCount: steps.length, minRequired: 6 },
    });
  }

  // 3. Twin stops : SEULEMENT paires CONSÉCUTIVES < 100m
  //
  // Politique 2026-05-13 (alignée sur le repair) :
  //   On flag UNIQUEMENT quand 2 stops consécutifs sont à moins de 100m,
  //   parce que c'est la seule garantie que l'auto-repair peut donner
  //   (findReorderSwap dans pipeline-auto-repair.ts ne vérifie que les
  //   distances consécutives après swap).
  //
  // Le cas "backtrack" (Step 1 et Step 4 au même endroit géographique
  // mais séparés par 2 stops dans l'ordre) est ACCEPTABLE — le joueur
  // fait un aller-retour normal, ne visite pas le même endroit en
  // séquence directe. C'était la décision design du user.
  //
  // AVANT cette politique (bug observé La Rochelle 13/05) : le validator
  // checkait toutes les paires O(N²), flaggait Step 1 ↔ Step 4 à 89m,
  // le repair tentait des swaps qui passaient le critère consécutif
  // mais le validator re-détectait la même paire → boucle infinie →
  // needs_review faussement déclenché.
  const twins: Array<{
    a: number; b: number; distanceM: number; aName: string; bName: string;
  }> = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const a = steps[i];
    const b = steps[i + 1];
    const d = haversineMeters(
      { lat: a.latitude, lon: a.longitude },
      { lat: b.latitude, lon: b.longitude },
    );
    if (d < 100) {
      twins.push({
        a: a.step_order,
        b: b.step_order,
        distanceM: Math.round(d),
        aName: a.landmark_name,
        bName: b.landmark_name,
      });
    }
  }
  if (twins.length > 0) {
    issues.push({
      code: "twin_stops",
      message:
        `${twins.length} consecutive twin-stop pair(s) detected (< 100m apart) — player will visit the same physical place back-to-back. ` +
        twins
          .map(
            (t) =>
              `Step ${t.a} "${t.aName}" ↔ Step ${t.b} "${t.bName}" = ${t.distanceM}m`,
          )
          .join(" ; "),
      details: { twins },
    });
  }

  // 4. (SUPPRIMÉ 2026-05-13) — roman_date_drift check
  // Cette vérification existait pour détecter quand l'ar_facade_text
  // était un Roman numeral dont la valeur décimale ne matchait pas les
  // dates mentionnées dans le riddle/anecdote.
  //
  // POLITIQUE NOUVELLE : les Roman numerals sont TOTALEMENT bannis du
  // pipeline (cf. RULE 3b dans anthropic.ts generateGameSteps + post-
  // processor sanitizeRomanNumeralField + replaceRomansEmbedded). Plus
  // aucun ar_facade_text/answer_text ne devrait être un Roman ; s'il
  // l'est encore (Claude récalcitrant), le post-processor le convertit
  // en arabe avant le retour. Donc plus de drift possible.
  //
  // Raison : ElevenLabs TTS ne sait pas lire les Romans (lit lettre par
  // lettre "M-D-C-X-X-V-I-I-I"), expérience joueur cassée. + drift
  // entre dates riddle et année facade impossible à auto-repair.

  // ─────────────────────────────────────────────────────────────────
  // 4.1 (NEW 2026-05-17) — Indice quality : doublons / weak / fake
  // ─────────────────────────────────────────────────────────────────
  // INV-1 safety net : pas de doublons answer_text. Le prompt l'interdit
  // déjà mais on double-check (cf. incident Séville AURUM x2 → favagis).
  const answerCounts = new Map<string, number[]>();
  for (const s of steps) {
    const key = (s.answer_text ?? "").trim().toLowerCase();
    if (!key) continue;
    const arr = answerCounts.get(key) ?? [];
    arr.push(s.step_order);
    answerCounts.set(key, arr);
  }
  const dupes = Array.from(answerCounts.entries()).filter(
    ([, orders]) => orders.length > 1,
  );
  if (dupes.length > 0) {
    issues.push({
      code: "duplicate_indice",
      message:
        `INV-1 violation : ${dupes.length} answer_text(s) used on multiple stops : ` +
        dupes.map(([w, orders]) => `"${w}" on steps ${orders.join("+")}`).join(" ; "),
      details: { duplicates: dupes.map(([w, o]) => ({ answer: w, steps: o })) },
    });
  }

  // Weak / fake indices : applique les mêmes guards qu'à la génération.
  const weakStops: number[] = [];
  const fakeStops: number[] = [];
  for (const s of steps) {
    const norm = (s.answer_text ?? "").trim().toLowerCase();
    if (!norm) continue;
    if (WEAK_ANSWERS.has(norm)) weakStops.push(s.step_order);
    if (KNOWN_FAKE_TOKENS.has(norm)) fakeStops.push(s.step_order);
  }
  if (weakStops.length > 0) {
    issues.push({
      code: "weak_indice",
      message:
        `Stops ${weakStops.join(", ")} use generic "weak" answer_text (secret, mystery, harmony, etc.) — final puzzle will feel hollow.`,
      details: { stops: weakStops },
    });
  }
  if (fakeStops.length > 0) {
    issues.push({
      code: "fake_indice",
      message:
        `Stops ${fakeStops.join(", ")} use a known fake-latin token (favagis, geverus, etc.) — Claude hallucination.`,
      details: { stops: fakeStops },
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // 4.2 — Final answer quality
  // ─────────────────────────────────────────────────────────────────
  if (game.final_answer) {
    const normFinal = String(game.final_answer).trim().toLowerCase();
    if (WEAK_ANSWERS.has(normFinal)) {
      issues.push({
        code: "weak_final",
        message: `final_answer "${game.final_answer}" is a generic weak word (any theme fits) — game climax will disappoint.`,
        details: { finalAnswer: game.final_answer },
      });
    }
    if (KNOWN_FAKE_TOKENS.has(normFinal)) {
      issues.push({
        code: "fake_final",
        message: `final_answer "${game.final_answer}" is a known fake-latin neologism — Claude hallucination, unsolvable by player.`,
        details: { finalAnswer: game.final_answer },
      });
    }
  }

  // Final explanation should cite at least 50% of the indices to feel
  // earned (player wants to see "here is how each of your 8 words led
  // here"). If fewer than half are referenced, the explanation feels
  // disconnected (cf. incident Aegina v1 où l'explication ne citait
  // que 6/8 des indices).
  const explanationText = (() => {
    const raw = game.final_answer_explanation;
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const en = typeof obj.en === "string" ? obj.en : null;
      const first = en ?? Object.values(obj).find((v): v is string => typeof v === "string");
      return first ?? "";
    }
    return "";
  })().toLowerCase();
  if (explanationText.length > 100) {
    const cited = steps.filter((s) => {
      const norm = (s.answer_text ?? "").trim().toLowerCase();
      return norm.length >= 3 && explanationText.includes(norm);
    }).length;
    const minRequired = Math.ceil(steps.length / 2);
    if (cited < minRequired) {
      issues.push({
        code: "missing_final_explanation",
        message: `final_answer_explanation only cites ${cited}/${steps.length} indices (min ${minRequired} expected). Player won't see how their collected words derive the answer.`,
        details: { citedCount: cited, totalSteps: steps.length, minRequired },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 4.3 — AR character diversity (INV-2 safety net)
  // ─────────────────────────────────────────────────────────────────
  const arTypes = new Set(
    steps
      .map((s) => (s.ar_character_type ?? "").trim())
      .filter((t) => t.length > 0),
  );
  const minArDiversity = Math.min(4, steps.length);
  if (arTypes.size < minArDiversity) {
    issues.push({
      code: "ar_diversity_low",
      message:
        `Only ${arTypes.size} distinct ar_character_type used across ${steps.length} stops (min ${minArDiversity} expected). Game will feel monotone.`,
      details: { distinctTypes: Array.from(arTypes), minRequired: minArDiversity },
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // 4.4 — GPS cluster sanity : aucun stop ne doit être à > THRESHOLD de
  // la médiane (signal d'un stop teleporté ailleurs sur la carte par
  // hallucination Gemini).
  //
  // THRESHOLD (2026-05-21) : scalé par transport_mode + radius_km.
  //   - walking         : 15 km (le 1.5 km radius nominal, +marge ×10
  //                       pour absorber widening 2.5× + mixed-mode Aegina-
  //                       style 35 km de diamètre légitime).
  //   - mixed / driving : max(15 km, radius_km × 1000) — un roadtrip
  //                       60 km est CONÇU pour avoir des stops espacés
  //                       jusqu'à 60 km du startPoint (Loire châteaux :
  //                       Chenonceau légitimement à 34 km de Blois).
  //                       Hardcoder 15 km flag-erait toujours en faux
  //                       positif.
  //
  // Si transport_mode = walking : comportement legacy 15 km.
  // ─────────────────────────────────────────────────────────────────
  if (steps.length >= 3) {
    const isRoadtrip =
      game.transport_mode === "mixed" || game.transport_mode === "driving";
    const radiusKm = (game.radius_km as number | null | undefined) ?? 0;
    const clusterThresholdM = isRoadtrip
      ? Math.max(15_000, radiusKm * 1000)
      : 15_000;
    const lats = steps.map((s) => s.latitude).sort((a, b) => a - b);
    const lons = steps.map((s) => s.longitude).sort((a, b) => a - b);
    const medianLat = lats[Math.floor(lats.length / 2)];
    const medianLon = lons[Math.floor(lons.length / 2)];
    const outliers = steps
      .map((s) => ({
        step: s.step_order,
        name: s.landmark_name,
        distance: haversineMeters(
          { lat: s.latitude, lon: s.longitude },
          { lat: medianLat, lon: medianLon },
        ),
      }))
      .filter((o) => o.distance > clusterThresholdM);
    if (outliers.length > 0) {
      issues.push({
        code: "gps_out_of_cluster",
        message:
          `${outliers.length} stop(s) more than ${Math.round(clusterThresholdM / 1000)} km from the median GPS — probable hallucination teleporting them out of the game zone : ` +
          outliers
            .map((o) => `Step ${o.step} "${o.name}" = ${Math.round(o.distance / 1000)} km`)
            .join(" ; "),
        details: { medianLat, medianLon, outliers, thresholdM: clusterThresholdM, transportMode: game.transport_mode, radiusKm },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 4.45 (NEW B3 2026-05-17) — GPS cross-validation : pour chaque stop,
  // on refait UN appel `geocodeLocation(landmark_name, city, country)`
  // avec un rayon de bias plus large (10 km au lieu de 2 km) et on
  // compare les coords retournées avec celles déjà stockées en DB.
  //
  // Pourquoi : le geocoding initial utilise un bias de 2 km centré sur
  // le startPoint. Si Gemini a fourni un name + address légèrement
  // décalés, Google a pu accepter un POI homonyme à 200-500m du bon.
  // En re-geocodant SANS le bias serré, on vérifie que Google retourne
  // toujours le même endroit. Divergence > 300 m = drift suspect.
  //
  // Coût : 8 appels Google Places par jeu (~$0.04). Acceptable pour
  // un commit de validation qualité avant facturation client.
  //
  // Skipped si GOOGLE_MAPS_API_KEY pas défini (préviews / local dev).
  // Skipped aussi si options.skipCrossValidation=true (auto-repair loop,
  // cron retries — pas de raison de re-payer les 8 appels Google si les
  // coords n'ont pas changé). Cf. cost incident 2026-05-18.
  // ─────────────────────────────────────────────────────────────────
  if (process.env.GOOGLE_MAPS_API_KEY && !options.skipCrossValidation) {
    const drifts: Array<{
      step: number;
      name: string;
      dbCoords: { lat: number; lon: number };
      googleCoords: { lat: number; lon: number };
      driftM: number;
    }> = [];
    const cityForGeocode = game.city ?? "";
    for (const s of steps) {
      // Skip stops sans nom (data corruption — déjà flaggé ailleurs)
      if (!s.landmark_name || typeof s.landmark_name !== "string") continue;
      try {
        const result = await geocodeLocation(s.landmark_name, cityForGeocode, "", {
          // Pas de referencePoint = pas de bias = Google libre de retourner
          // le POI le plus probable au monde pour ce nom. Si city dans le
          // nom suffit (Gemini envoie typiquement "Cathedral of X, Y"),
          // Google va converger sur le bon endroit.
          referencePoint: undefined,
        });
        if (!result) continue; // pas trouvé sans bias, skip silencieusement
        const drift = haversineMeters(
          { lat: s.latitude, lon: s.longitude },
          { lat: result.lat, lon: result.lon },
        );
        if (drift > 300) {
          drifts.push({
            step: s.step_order,
            name: s.landmark_name,
            dbCoords: { lat: s.latitude, lon: s.longitude },
            googleCoords: { lat: result.lat, lon: result.lon },
            driftM: Math.round(drift),
          });
        }
      } catch {
        // Network errors silently ignored — c'est un check de qualité,
        // pas un blocker fonctionnel.
      }
    }
    if (drifts.length > 0) {
      issues.push({
        code: "gps_cross_check_drift",
        message:
          `${drifts.length} stop(s) drift > 300 m between stored GPS and clean re-geocode (without 2 km bias). Possible Gemini-supplied name+coords accepted by biased Google but contradicted by unbiased Google : ` +
          drifts
            .map(
              (d) =>
                `Step ${d.step} "${d.name}" = ${d.driftM} m off`,
            )
            .join(" ; "),
        details: { drifts },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 4.5 — Sources coverage : signal qu'on a inventé des stops sans
  // backup Wikipedia / source officielle.
  //
  // (Sprint 5, 2026-05-21) — REFINED policy to reduce false positives.
  // Le check précédent flag-eait à 25% sourceless ratio sans distinguer :
  //   (a) stops vraiment obscurs (hallucination risk élevé)
  //   (b) stops iconiques mondialement connus mais arrivés via le fallback
  //       Perplexity sub-monuments path (qui ne remplit pas
  //       landmark_citation). Cas observé 2026-05-21 sur Versailles :
  //       "Royal Opera of Versailles" + "Palace of Versailles" flagged
  //       comme sourceless alors qu'ils sont littéralement les landmarks
  //       les plus connus de France.
  //
  // NEW POLICY :
  //   1. On filtre les stops sourceless en RETIRANT ceux dont
  //      landmark_name matche un pattern "iconique évident"
  //      (cf. ICONIC_LANDMARK_PATTERNS). Ces stops sont nécessairement
  //      réels (Wikipedia les indexe sous des dizaines de variantes).
  //   2. On garde le threshold à 25% sur les stops RESTANTS (=
  //      vraiment obscurs). Si > 25%, on flag.
  // ─────────────────────────────────────────────────────────────────
  const ICONIC_LANDMARK_PATTERNS = [
    /\bpalace of\b/i,
    /\bpalais\b/i,
    /\bch[âa]teau\b/i,
    /\bcastle\b/i,
    /\bcathedral\b/i,
    /\bcath[ée]drale\b/i,
    /\bbasilica\b/i,
    /\bbasilique\b/i,
    /\bopera (house|of)\b/i,
    /\b(royal|imperial|grand) opera\b/i,
    /\bnotre[- ]dame\b/i,
    /\bsacr[ée][- ]c[oœ]ur\b/i,
    /\btemple of\b/i,
    /\b(grand|petit) mosque\b/i,
    /\b(grand|petit) mosqu[ée]e\b/i,
    /\bsynagogue\b/i,
    /\btower of\b/i,
    /\btour (eiffel|de|du)\b/i,
    /\b(triumphal|arch of)\b/i,
    /\barc de triomphe\b/i,
    /\bacropolis\b/i,
    /\b(roman|imperial) forum\b/i,
    /\bcolos+eum\b/i,
    /\bpantheon\b/i,
    /\bpanth[ée]on\b/i,
    /\babbey\b/i,
    /\babbaye\b/i,
    /\bmonastery\b/i,
    /\bmonast[èe]re\b/i,
    /\bh[oô]tel de ville\b/i,
    /\bcity hall\b/i,
    /\bcapitole\b/i,
    /\bcapitol\b/i,
    /\b(louvre|orsay|prado|uffizi|hermitage|met(\b| museum))\b/i,
    /\b(buckingham|windsor|kremlin|topkapı|topkapi|alhambra|alc[áa]zar)\b/i,
    /\bmuseum of\b/i,
    /\bmus[ée]e (du|de la|d'|national|royal)\b/i,
  ];

  const isIconicLandmark = (name: string): boolean =>
    ICONIC_LANDMARK_PATTERNS.some((p) => p.test(name));

  const sourceless = steps.filter(
    (s) =>
      !s.poi_category ||
      !s.landmark_citation ||
      String(s.landmark_citation).trim().length === 0,
  );
  // Filter out iconic landmarks — they ARE real even if our pipeline
  // didn't populate citation (typically the Perplexity sub-monument path).
  const trulySourceless = sourceless.filter(
    (s) => !isIconicLandmark(s.landmark_name ?? ""),
  );
  const escapedAsIconic = sourceless.length - trulySourceless.length;
  if (escapedAsIconic > 0) {
    console.log(
      `[pipeline-validators] sources_thin check : ${escapedAsIconic}/${sourceless.length} sourceless stops escaped as iconic landmarks (whitelist match)`,
    );
  }
  const sourcelessRatio = trulySourceless.length / steps.length;
  if (sourcelessRatio > 0.25) {
    issues.push({
      code: "sources_thin",
      message:
        `${trulySourceless.length}/${steps.length} non-iconic stops lack poi_category or landmark_citation (${Math.round(sourcelessRatio * 100)}%). Risk of fictional / hallucinated landmarks.`,
      details: {
        sourcelessStops: trulySourceless.map((s) => ({
          step: s.step_order,
          name: s.landmark_name,
        })),
        escapedAsIconic,
      },
    });
  }

  // 5. Translation completeness (if language provided)
  //
  // S9 (2026-05-20) — Skip pour mode='city_tour' : le contenu tour est
  // généré DIRECTEMENT dans la langue cible (mon prompt encyclopédique
  // produit le contenu en français quand language=fr). Donc aucun cache
  // de traduction n'est nécessaire — l'API joueur lit `game_steps`
  // directement et obtient déjà du FR. Le check coverage est donc
  // inadapté à ce mode et créait une boucle infernale auto-repair
  // (validator dit 7/39 incomplete → auto-repair retrigger pre-package
  // → no-op car déjà cached → validator re-flag → boucle).
  const gameMode = (game as { mode?: string }).mode ?? "city_game";
  if (language && language !== "en" && gameMode !== "city_tour") {
    const stepIds = steps.map((s) => s.id);
    const { count: gameTrCount } = await supabase
      .from("translations_cache")
      .select("*", { count: "exact", head: true })
      .eq("source_id", gameId)
      .eq("language", language);
    const { count: stepTrCount } = await supabase
      .from("translations_cache")
      .select("*", { count: "exact", head: true })
      .in("source_id", stepIds)
      .eq("language", language);

    // Expected : 4 game-level (title, description, epilogue_title, epilogue_text)
    // + 5 step-level (title, riddle_text, anecdote, ar_character_dialogue,
    //   ar_treasure_reward) × N steps
    const expectedGame = 4;
    const expectedSteps = steps.length * 5;
    const totalCached = (gameTrCount || 0) + (stepTrCount || 0);
    const totalExpected = expectedGame + expectedSteps;
    if (totalCached < totalExpected) {
      issues.push({
        code: "translation_incomplete",
        message:
          `Only ${totalCached}/${totalExpected} fields translated to ${language} ` +
          `(game=${gameTrCount}/${expectedGame}, steps=${stepTrCount}/${expectedSteps}). ` +
          `Gemini likely rate-limited. Player will see EN text on missing fields.`,
        details: {
          language,
          gameCached: gameTrCount,
          gameExpected: expectedGame,
          stepCached: stepTrCount,
          stepExpected: expectedSteps,
        },
      });
    }
  }

  // 6. Audio coverage matching translations
  if (language && language !== "en") {
    const { count: audioCount } = await supabase
      .from("audio_cache")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId)
      .eq("language", language);
    // Expected : 3 per step (riddle, character, anecdote) + 1 epilogue
    const expectedAudio = steps.length * 3 + 1;
    if ((audioCount || 0) < expectedAudio) {
      issues.push({
        code: "audio_coverage_mismatch",
        message:
          `Only ${audioCount}/${expectedAudio} audio files in ${language} ` +
          `(translation fallback to EN auto-skipped some). Player will hear browser TTS on missing slots.`,
        details: {
          language,
          audioCount,
          audioExpected: expectedAudio,
        },
      });
    }
  }

  const reviewReason =
    issues.length === 0
      ? ""
      : issues.map((i) => `[${i.code}] ${i.message}`).join(" | ");

  return {
    ok: issues.length === 0,
    issues,
    reviewReason,
  };
}
