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

/** Une issue détectée par le validator. */
export interface ValidationIssue {
  /** Code machine-parseable. */
  code:
    | "twin_stops"
    | "below_floor"
    | "roman_date_drift"
    | "translation_incomplete"
    | "audio_coverage_mismatch";
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
export async function validateFinalGame(
  gameId: string,
  language: string | undefined,
): Promise<ValidationResult> {
  const supabase = createAdminClient();
  const issues: ValidationIssue[] = [];

  // 1. Fetch game + steps
  const { data: game, error: gameErr } = await supabase
    .from("games")
    .select("id, slug, title, transport_mode")
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
      "id, step_order, title, landmark_name, latitude, longitude, riddle_text, anecdote, ar_facade_text, answer_text",
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

  // 4. Roman numeral context-aware drift check
  // Pour chaque step dont ar_facade_text est un Roman numeral valide,
  // extrait les dates de riddle + anecdote et vérifie qu'au moins une
  // date extraite est dans ±50 ans de la valeur décimale du roman.
  const romanDrifts: Array<{
    step: number; roman: string; decoded: number; mentionedDates: number[];
  }> = [];
  for (const step of steps) {
    const ar = (step.ar_facade_text || "").trim();
    const decoded = decodeRoman(ar);
    if (decoded === null) continue; // pas un Roman (ex: LUGUS, VERITAS)
    const text = `${step.riddle_text || ""}\n${step.anecdote || ""}`;
    const dates = extractDates(text);
    if (dates.length === 0) continue; // pas de date dans la narration, skip check
    const matches = dates.some((d) => Math.abs(d - decoded) <= 50);
    if (!matches) {
      romanDrifts.push({
        step: step.step_order,
        roman: ar,
        decoded,
        mentionedDates: dates,
      });
    }
  }
  if (romanDrifts.length > 0) {
    issues.push({
      code: "roman_date_drift",
      message:
        `${romanDrifts.length} Roman numeral(s) drift > 50y vs narration dates — player will input the wrong year following the hints. ` +
        romanDrifts
          .map(
            (d) =>
              `Step ${d.step}: ${d.roman}=${d.decoded} but riddle/anecdote mention ${d.mentionedDates.join(", ")}`,
          )
          .join(" ; "),
      details: { romanDrifts },
    });
  }

  // 5. Translation completeness (if language provided)
  if (language && language !== "en") {
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
