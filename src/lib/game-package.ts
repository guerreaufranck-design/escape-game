/**
 * Game package preparation: text translation + audio generation
 * for a (game × language) pair.
 *
 * Called by /api/external/generate-code when a customer purchases a
 * code with a chosen language. Pre-warms the cache so the player
 * has zero loading at activation:
 *   - All voiceable texts (character dialogue, anecdote, epilogue)
 *     are translated and cached in translations_cache
 *   - All voiceable texts get a corresponding ElevenLabs MP3 in
 *     audio_cache + Supabase Storage
 *
 * Idempotent: if a (game × language × slot) row already exists in
 * audio_cache, that slot is skipped.
 *
 * Synchronous on purpose. Caller decides whether to await (to send
 * email after) or fire-and-forget (Vercel might cut off — see notes
 * in the API route).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { translateGameField, translateStepFields, translateUIStrings } from "@/lib/translate-service";
import { generateAndStoreAudio, buildAudioPath } from "@/lib/elevenlabs";
import { voiceFor } from "@/lib/voice-map";
import { t, isStaticLocale } from "@/lib/i18n";
import { ui } from "@/lib/translations";

export interface PackageResult {
  success: boolean;
  gameId: string;
  language: string;
  audioGenerated: number;
  audioSkipped: number;
  audioFailed: number;
  durationMs: number;
  errors: string[];
}

interface AudioJob {
  stepOrder: number;
  slot: "character" | "anecdote" | "epilogue" | "riddle";
  text: string;
  voiceId: string;
}

/**
 * Prepare everything the player needs to play the game in `language`:
 * translated texts (cached) + narration MP3s (cached + uploaded).
 *
 * Static locales (fr/en/de/es/it) skip text translation since the
 * source already includes them — only audio is generated.
 */
export async function prepareGamePackage(
  gameId: string,
  language: string,
): Promise<PackageResult> {
  const t0 = Date.now();
  const errors: string[] = [];
  let audioGenerated = 0;
  let audioSkipped = 0;
  let audioFailed = 0;

  const supabase = createAdminClient();

  // 1. Fetch game (title + description + epilogue + check existence).
  // Title and description are shown on the briefing screen, so they
  // must be in the player's language at activation — pre-translating
  // them here means /api/game hits a warm cache instead of a 5-15s
  // Gemini round-trip.
  const { data: game, error: gameErr } = await supabase
    .from("games")
    .select("id, title, description, epilogue_text")
    .eq("id", gameId)
    .single();

  if (gameErr || !game) {
    return {
      success: false,
      gameId,
      language,
      audioGenerated: 0,
      audioSkipped: 0,
      audioFailed: 0,
      durationMs: Date.now() - t0,
      errors: [`Game ${gameId} not found`],
    };
  }

  // Pre-warm the UI translation pack (tutorial + buttons + chrome) so the
  // first page load in this language doesn't trigger /api/translations
  // round-trips. No-op for static locales — those are bundled in code.
  if (!isStaticLocale(language)) {
    try {
      const englishUi: Record<string, string> = {};
      for (const [key, entry] of Object.entries(ui)) {
        englishUi[key] = entry.en || entry.fr || key;
      }
      await translateUIStrings(englishUi, language);
    } catch (err) {
      // Don't fail the whole package on UI pre-warm — the player can
      // still load (the on-demand fetch will catch up).
      console.warn(
        `[game-package] UI pre-warm for ${language} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // 1b. Translate game-level fields (title + description) so the
  // briefing screen renders straight from cache.
  if (language !== "en") {
    const englishGameTitle = t(game.title, "en");
    const englishGameDescription = t(game.description, "en");
    if (englishGameTitle) {
      try {
        await translateGameField(
          game.id,
          "games",
          "title",
          englishGameTitle,
          language,
        );
      } catch (err) {
        console.warn(
          `[game-package] game.title translation failed for ${language}: ${err instanceof Error ? err.message : err}`,
        );
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    if (englishGameDescription) {
      try {
        await translateGameField(
          game.id,
          "games",
          "description",
          englishGameDescription,
          language,
        );
      } catch (err) {
        console.warn(
          `[game-package] game.description translation failed for ${language}: ${err instanceof Error ? err.message : err}`,
        );
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  // 2. Fetch all steps with every translatable field. We pre-translate
  // ALL of them (riddle, anecdote, character dialogue, treasure reward,
  // hints, attractions) so the player API only ever reads from cache —
  // no inline Gemini calls during the playthrough.
  const { data: steps, error: stepsErr } = await supabase
    .from("game_steps")
    .select("id, step_order, title, riddle_text, anecdote, ar_character_dialogue, ar_character_type, ar_treasure_reward, hints, route_attractions")
    .eq("game_id", gameId)
    .order("step_order");

  if (stepsErr || !steps?.length) {
    return {
      success: false,
      gameId,
      language,
      audioGenerated: 0,
      audioSkipped: 0,
      audioFailed: 0,
      durationMs: Date.now() - t0,
      errors: [`No steps found for game ${gameId}`],
    };
  }

  // 3. Check which audio slots are already in cache (idempotency)
  const { data: existing } = await supabase
    .from("audio_cache")
    .select("step_order, slot")
    .eq("game_id", gameId)
    .eq("language", language);

  const cachedSlots = new Set(
    (existing || []).map((r) => `${r.step_order}:${r.slot}`),
  );

  // 4. Build the list of jobs (translate text first, then queue audio)
  const jobs: AudioJob[] = [];

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const step = steps[stepIdx];
    // Pace Gemini calls — bursting too fast triggers a 400 with
    // "API_KEY_INVALID" message that is in fact a soft rate-limit. 800ms
    // between steps keeps the orchestrator under that threshold even on
    // long games. Skipped for the first iteration.
    if (stepIdx > 0 && !isStaticLocale(language)) {
      await new Promise((r) => setTimeout(r, 800));
    }
    // Get translated text for every voiceable + visible field on the step.
    // Translating the title here too means /api/game/[sessionId] hits
    // pure cache when the player loads — no inline Gemini calls, no
    // perceived loading after activation.
    const englishTitle = t(step.title, "en");
    const englishRiddle = t(step.riddle_text, "en");
    const englishCharacter = t(step.ar_character_dialogue, "en");
    const englishAnecdote = t(step.anecdote, "en");

    // Translate every visible/voiceable field via translateGameField.
    // The function is a no-op when targetLang === "en" (source language)
    // and otherwise translates via Gemini + writes the result into
    // translations_cache. We always go through it — even for "static"
    // locales like fr/de/es/it — because game CONTENT was generated by
    // Claude in English, NOT bundled in translations.ts (only UI strings
    // are bundled). Without this, /api/game hit Gemini inline on first
    // load, adding 5-15s of perceived loading after activation.
    if (englishTitle && language !== "en") {
      await translateGameField(
        step.id,
        "game_steps",
        "title",
        englishTitle,
        language,
      );
      await new Promise((r) => setTimeout(r, 400));
    }
    const riddleText: string = englishRiddle
      ? await translateGameField(
          step.id,
          "game_steps",
          "riddle_text",
          englishRiddle,
          language,
        )
      : "";
    await new Promise((r) => setTimeout(r, 400));
    const characterText: string = englishCharacter
      ? await translateGameField(
          step.id,
          "game_steps",
          "ar_character_dialogue",
          englishCharacter,
          language,
        )
      : "";
    await new Promise((r) => setTimeout(r, 400));
    const anecdoteText: string = englishAnecdote
      ? await translateGameField(
          step.id,
          "game_steps",
          "anecdote",
          englishAnecdote,
          language,
        )
      : "";

    // Pre-translate every remaining display field so the in-game APIs
    // never need to call Gemini at runtime. Same pattern as above:
    // skip when targetLang === "en" (source) and pace between calls.
    if (language !== "en") {
      // ar_treasure_reward — shown when the player opens the AR chest.
      const englishTreasure = t(step.ar_treasure_reward, "en");
      if (englishTreasure) {
        await new Promise((r) => setTimeout(r, 400));
        try {
          await translateGameField(
            step.id,
            "game_steps",
            "ar_treasure_reward",
            englishTreasure,
            language,
          );
        } catch (err) {
          console.warn(
            `[game-package] step ${step.step_order} ar_treasure_reward translation failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      // hints — JSONB array. Translate each entry's text under the same
      // synthetic cache key the player API uses (`hint-<gameId>-<stepNum>-<idx>`).
      const rawHints = Array.isArray(step.hints) ? step.hints : [];
      for (let hintIdx = 0; hintIdx < rawHints.length; hintIdx++) {
        const hint = rawHints[hintIdx] as { text?: unknown } | null;
        if (!hint || hint.text === undefined || hint.text === null) continue;
        const englishHint = t(hint.text, "en");
        if (!englishHint) continue;
        await new Promise((r) => setTimeout(r, 400));
        try {
          await translateGameField(
            `hint-${gameId}-${step.step_order}-${hintIdx}`,
            "game_steps",
            "hint_text",
            englishHint,
            language,
          );
        } catch (err) {
          console.warn(
            `[game-package] step ${step.step_order} hint ${hintIdx} translation failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      // route_attractions — JSONB array of {name, fact}. Translated under
      // the synthetic cache key `<stepId>-attraction-<idx>` via the
      // batch helper (one Gemini call per attraction covering both fields).
      const rawAttractions = Array.isArray(step.route_attractions)
        ? (step.route_attractions as Array<{ name?: unknown; fact?: unknown }>)
        : [];
      for (let attrIdx = 0; attrIdx < rawAttractions.length; attrIdx++) {
        const attr = rawAttractions[attrIdx];
        const enFields: Record<string, string> = {};
        const enName = t(attr?.name, "en");
        const enFact = t(attr?.fact, "en");
        if (enName) enFields.name = enName;
        if (enFact) enFields.fact = enFact;
        if (Object.keys(enFields).length === 0) continue;
        await new Promise((r) => setTimeout(r, 400));
        try {
          await translateStepFields(
            `${step.id}-attraction-${attrIdx}`,
            enFields,
            language,
          );
        } catch (err) {
          console.warn(
            `[game-package] step ${step.step_order} attraction ${attrIdx} translation failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    const voiceId = voiceFor(step.ar_character_type, language);

    if (riddleText?.trim() && !cachedSlots.has(`${step.step_order}:riddle`)) {
      jobs.push({
        stepOrder: step.step_order,
        slot: "riddle",
        text: riddleText,
        voiceId: voiceFor("narrator", language),
      });
    } else if (cachedSlots.has(`${step.step_order}:riddle`)) {
      audioSkipped++;
    }

    if (characterText?.trim() && !cachedSlots.has(`${step.step_order}:character`)) {
      jobs.push({
        stepOrder: step.step_order,
        slot: "character",
        text: characterText,
        voiceId,
      });
    } else if (cachedSlots.has(`${step.step_order}:character`)) {
      audioSkipped++;
    }

    if (anecdoteText?.trim() && !cachedSlots.has(`${step.step_order}:anecdote`)) {
      jobs.push({
        stepOrder: step.step_order,
        slot: "anecdote",
        text: anecdoteText,
        voiceId: voiceFor("narrator", language),
      });
    } else if (cachedSlots.has(`${step.step_order}:anecdote`)) {
      audioSkipped++;
    }
  } // end steps loop

  // 5. Epilogue (slot=epilogue, conventional step_order=0)
  if (game.epilogue_text) {
    const englishEpilogue = t(game.epilogue_text, "en");
    // Always go through translateGameField — game content was generated
    // in English by Claude, so even "static" locales (fr/de/es/it) need
    // a Gemini call (cached after first hit).
    const epilogueText: string =
      language === "en"
        ? englishEpilogue
        : await translateGameField(
            game.id,
            "games",
            "epilogue_text",
            englishEpilogue,
            language,
          );
    if (epilogueText?.trim() && !cachedSlots.has(`0:epilogue`)) {
      jobs.push({
        stepOrder: 0,
        slot: "epilogue",
        text: epilogueText,
        voiceId: voiceFor("narrator", language),
      });
    } else if (cachedSlots.has(`0:epilogue`)) {
      audioSkipped++;
    }
  }

  // 6. Generate audio sequentially. ElevenLabs handles concurrency at
  // their end — we hit one job at a time to stay polite + predictable.
  for (const job of jobs) {
    try {
      const path = buildAudioPath(gameId, language, job.stepOrder, job.slot);
      const result = await generateAndStoreAudio({
        text: job.text,
        voiceId: job.voiceId,
        storagePath: path,
      });

      const { error: insertErr } = await supabase
        .from("audio_cache")
        .upsert(
          {
            game_id: gameId,
            step_order: job.stepOrder,
            language,
            slot: job.slot,
            storage_path: path,
            public_url: result.publicUrl,
            byte_size: result.byteSize,
          },
          { onConflict: "game_id,step_order,language,slot" },
        );

      if (insertErr) {
        errors.push(
          `audio_cache upsert failed for step ${job.stepOrder} ${job.slot}: ${insertErr.message}`,
        );
        audioFailed++;
        continue;
      }

      audioGenerated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`step ${job.stepOrder} ${job.slot}: ${msg.slice(0, 150)}`);
      audioFailed++;
    }
  }

  return {
    success: audioFailed === 0,
    gameId,
    language,
    audioGenerated,
    audioSkipped,
    audioFailed,
    durationMs: Date.now() - t0,
    errors,
  };
}
