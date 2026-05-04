/**
 * Read-only audit of a game's data completeness. Powers the green/
 * yellow/red badge in the admin games list and the post-refresh
 * summary returned to the client.
 *
 * Cheap to call: a handful of indexed Supabase queries, no AI.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export type HealthLevel = "ok" | "partial" | "stale";

export interface GameHealth {
  level: HealthLevel;
  // Headline: 1-line plain-French summary for the admin tooltip.
  summary: string;
  // Issues by category — useful both for UI bullets and to know what
  // the refresh API will need to fix.
  issues: {
    maxHintsCapTooLow: boolean;
    stepsWithFewerThan3Hints: number[];
    languagesPackagedNotFullyTranslated: string[];
    languagesPackagedMissingAudio: string[];
  };
  // Number of (game x language) pairs we know are packaged. Used by the
  // refresh API to decide how much work to schedule.
  packagedLanguages: string[];
}

/**
 * Translation-cache fields we expect for every step at full health.
 * Excludes ar_facade_text on purpose (kept untranslated by design).
 */
const STEP_TRANSLATABLE_FIELDS = [
  "title",
  "riddle_text",
  "anecdote",
  "ar_character_dialogue",
  "ar_treasure_reward",
] as const;

const GAME_TRANSLATABLE_FIELDS = ["title", "description", "epilogue_text"] as const;

const AUDIO_SLOTS = ["riddle", "character", "anecdote", "epilogue"] as const;

export async function auditGameHealth(gameId: string): Promise<GameHealth> {
  const supabase = createAdminClient();

  // 1. Game row
  const { data: game } = await supabase
    .from("games")
    .select("id, max_hints_per_step, epilogue_text")
    .eq("id", gameId)
    .single();

  if (!game) {
    return {
      level: "stale",
      summary: "Jeu introuvable",
      issues: {
        maxHintsCapTooLow: false,
        stepsWithFewerThan3Hints: [],
        languagesPackagedNotFullyTranslated: [],
        languagesPackagedMissingAudio: [],
      },
      packagedLanguages: [],
    };
  }

  // 2. Steps
  const { data: steps } = await supabase
    .from("game_steps")
    .select("id, step_order, hints, route_attractions")
    .eq("game_id", gameId)
    .order("step_order");

  const stepCount = steps?.length ?? 0;
  const stepIds = (steps ?? []).map((s) => s.id);
  const stepsWithFewerThan3Hints = (steps ?? [])
    .filter((s) => !Array.isArray(s.hints) || s.hints.length < 3)
    .map((s) => s.step_order);

  const maxHintsCapTooLow = (game.max_hints_per_step ?? 0) < 3;

  // 3. Find all languages already packaged for this game (audio_cache
  // is the canonical "this customer paid, prepareGamePackage ran" set).
  const { data: audioRows } = await supabase
    .from("audio_cache")
    .select("language, slot")
    .eq("game_id", gameId);

  const languagesPackaged = Array.from(
    new Set((audioRows ?? []).map((a) => a.language)),
  ).sort();

  // 4. For each packaged language, check translation completeness
  //    (skip 'en' — source language, no translation needed)
  const languagesPackagedNotFullyTranslated: string[] = [];
  const languagesPackagedMissingAudio: string[] = [];

  for (const lang of languagesPackaged) {
    if (lang !== "en") {
      // Game-level translations
      const { count: gameTransCount } = await supabase
        .from("translations_cache")
        .select("source_field", { count: "exact", head: true })
        .eq("source_id", gameId)
        .eq("language", lang)
        .in("source_field", GAME_TRANSLATABLE_FIELDS as unknown as string[]);

      const gameTransExpected = GAME_TRANSLATABLE_FIELDS.filter((f) =>
        f === "epilogue_text" ? !!game.epilogue_text : true,
      ).length;

      // Step-level translations
      const { count: stepTransCount } = await supabase
        .from("translations_cache")
        .select("source_field", { count: "exact", head: true })
        .in("source_id", stepIds.length ? stepIds : ["__none__"])
        .eq("language", lang)
        .in("source_field", STEP_TRANSLATABLE_FIELDS as unknown as string[]);

      const stepTransExpected = stepCount * STEP_TRANSLATABLE_FIELDS.length;

      // Hint translations (synthetic keys)
      let hintTransCount = 0;
      for (const s of steps ?? []) {
        const hints = Array.isArray(s.hints) ? s.hints.length : 0;
        for (let i = 0; i < hints; i++) {
          const { count } = await supabase
            .from("translations_cache")
            .select("language", { count: "exact", head: true })
            .eq("source_id", `hint-${gameId}-${s.step_order}-${i}`)
            .eq("language", lang);
          if ((count ?? 0) > 0) hintTransCount++;
        }
      }
      const hintTransExpected = (steps ?? []).reduce(
        (sum, s) => sum + (Array.isArray(s.hints) ? s.hints.length : 0),
        0,
      );

      const totalExpected = gameTransExpected + stepTransExpected + hintTransExpected;
      const totalActual = (gameTransCount ?? 0) + (stepTransCount ?? 0) + hintTransCount;

      // Allow a small slack (≥90%) — some fields legitimately don't
      // translate (proper nouns identical across languages get the
      // "didn't translate" detection and aren't cached).
      if (totalExpected > 0 && totalActual < Math.floor(totalExpected * 0.9)) {
        languagesPackagedNotFullyTranslated.push(lang);
      }
    }

    // Audio completeness — every step should have riddle/character/anecdote
    // and the game one epilogue.
    const audioForLang = (audioRows ?? []).filter((a) => a.language === lang);
    const audioBySlot = new Map<string, number>();
    for (const a of audioForLang) {
      audioBySlot.set(a.slot, (audioBySlot.get(a.slot) ?? 0) + 1);
    }
    const audioMissing =
      (audioBySlot.get("riddle") ?? 0) < stepCount ||
      (audioBySlot.get("character") ?? 0) < stepCount ||
      (audioBySlot.get("anecdote") ?? 0) < stepCount ||
      (game.epilogue_text && (audioBySlot.get("epilogue") ?? 0) < 1);
    if (audioMissing) {
      languagesPackagedMissingAudio.push(lang);
    }
  }

  // 5. Compute level
  let level: HealthLevel = "ok";
  let summary = `À jour — 3 indices/étape, ${languagesPackaged.length || 0} langue(s) packagée(s).`;

  if (
    maxHintsCapTooLow ||
    stepsWithFewerThan3Hints.length > 0
  ) {
    level = "stale";
    const parts: string[] = [];
    if (maxHintsCapTooLow) parts.push(`cap d'indices à ${game.max_hints_per_step ?? 0}`);
    if (stepsWithFewerThan3Hints.length > 0)
      parts.push(`${stepsWithFewerThan3Hints.length} étape(s) avec < 3 indices`);
    summary = `Obsolète — ${parts.join(", ")}.`;
  } else if (
    languagesPackagedNotFullyTranslated.length > 0 ||
    languagesPackagedMissingAudio.length > 0
  ) {
    level = "partial";
    const parts: string[] = [];
    if (languagesPackagedNotFullyTranslated.length > 0)
      parts.push(
        `traductions incomplètes en ${languagesPackagedNotFullyTranslated.join(", ")}`,
      );
    if (languagesPackagedMissingAudio.length > 0)
      parts.push(
        `audio manquant en ${languagesPackagedMissingAudio.join(", ")}`,
      );
    summary = `Partiel — ${parts.join("; ")}.`;
  }

  return {
    level,
    summary,
    issues: {
      maxHintsCapTooLow,
      stepsWithFewerThan3Hints,
      languagesPackagedNotFullyTranslated,
      languagesPackagedMissingAudio,
    },
    packagedLanguages: languagesPackaged,
  };
}
