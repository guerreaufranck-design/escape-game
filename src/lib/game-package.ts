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
import { translateGameField } from "@/lib/translate-service";
import { generateAndStoreAudio, buildAudioPath } from "@/lib/elevenlabs";
import { voiceFor } from "@/lib/voice-map";
import { t, isStaticLocale } from "@/lib/i18n";

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
  slot: "character" | "anecdote" | "epilogue";
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

  // 1. Fetch game (epilogue + check existence)
  const { data: game, error: gameErr } = await supabase
    .from("games")
    .select("id, epilogue_text")
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

  // 2. Fetch all steps with the voiceable fields
  const { data: steps, error: stepsErr } = await supabase
    .from("game_steps")
    .select("id, step_order, anecdote, ar_character_dialogue, ar_character_type")
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
    // Get translated text for this step's character + anecdote
    const englishCharacter = t(step.ar_character_dialogue, "en");
    const englishAnecdote = t(step.anecdote, "en");

    // Translate per-field via translateGameField. We deliberately avoid
    // translateStepFields (batch) here: its `responseMimeType: "application/
    // json"` mode ran into a soft rate-limit on this account that returned
    // a misleading API_KEY_INVALID. Per-field calls go through cache first
    // and only hit Gemini once per (sourceId, field, language).
    let characterText: string;
    let anecdoteText: string;
    if (isStaticLocale(language)) {
      characterText = t(step.ar_character_dialogue, language);
      anecdoteText = t(step.anecdote, language);
    } else {
      characterText = englishCharacter
        ? await translateGameField(
            step.id,
            "game_steps",
            "ar_character_dialogue",
            englishCharacter,
            language,
          )
        : "";
      // Tiny pause before the second call to stay under Gemini's burst limit
      await new Promise((r) => setTimeout(r, 400));
      anecdoteText = englishAnecdote
        ? await translateGameField(
            step.id,
            "game_steps",
            "anecdote",
            englishAnecdote,
            language,
          )
        : "";
    }
    const voiceId = voiceFor(step.ar_character_type, language);

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
    let epilogueText: string;
    if (isStaticLocale(language)) {
      epilogueText = t(game.epilogue_text, language);
    } else {
      epilogueText = await translateGameField(
        game.id,
        "games",
        "epilogue_text",
        englishEpilogue,
        language,
      );
    }
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
