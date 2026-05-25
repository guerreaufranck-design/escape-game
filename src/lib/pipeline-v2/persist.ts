/**
 * PERSIST — écrit le StructuredGame + Translations + Audios en DB.
 *
 * Tables touchées :
 *   - games (UPDATE title, description, intro, epilogue, etc.)
 *   - game_steps (DELETE then INSERT 7-9 stops avec tous les champs)
 *   - translations_cache (UPSERT par lang × field)
 *   - audio_cache (UPSERT par lang × stop × slot avec storage_path)
 *
 * Si needsReview=true → on set games.needs_review=true + review_reason.
 */

import { createClient } from "@supabase/supabase-js";
import type {
  AudioResult,
  PipelineInput,
  StructuredGame,
  TranslationResult,
} from "./types";

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  return createClient(url, key);
}

/** Update games row (meta) + delete/insert game_steps. Idempotent. */
export async function persistGame(
  gameId: string,
  input: PipelineInput,
  structured: StructuredGame,
  needsReview: boolean,
  reviewReason: string | undefined,
  startPoint: { lat: number; lon: number },
) {
  const s = getClient();

  const { error: gErr } = await s
    .from("games")
    .update({
      title: structured.meta.title,
      description: structured.meta.description,
      intro_speech: structured.meta.intro,
      epilogue_title: structured.meta.epilogueTitle,
      epilogue_text: structured.meta.epilogue,
      final_riddle_text: structured.meta.finalRiddleText,
      final_answer: structured.meta.finalAnswer,
      final_answer_explanation: structured.meta.finalAnswerExplanation,
      start_point_lat: startPoint.lat,
      start_point_lon: startPoint.lon,
      start_point_source: "pipeline_v2",
      needs_review: needsReview,
      review_reason: reviewReason ?? null,
      mode: input.mode,
      transport_mode: input.transportMode ?? "walking",
      radius_km: input.radiusKm ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", gameId);
  if (gErr) throw new Error(`games update failed: ${gErr.message}`);

  const { error: delErr } = await s.from("game_steps").delete().eq("game_id", gameId);
  if (delErr) throw new Error(`game_steps delete failed: ${delErr.message}`);

  const rows = structured.stops.map((stop) => ({
    game_id: gameId,
    step_order: stop.step_order,
    title: stop.title,
    landmark_name: stop.landmarkName,
    latitude: stop.latitude,
    longitude: stop.longitude,
    riddle_text: stop.riddle,
    answer_text: stop.answer,
    hints: stop.hints,
    anecdote: stop.anecdote,
    ar_character_type: stop.arCharacterType,
    ar_character_dialogue: stop.arCharacterDialogue,
    ar_facade_text: stop.arFacadeText,
    ar_treasure_reward: stop.arTreasureReward,
    landmark_history: stop.landmarkHistory,
    validation_radius_meters: stop.validationRadiusMeters,
    bonus_time_seconds: stop.bonusTimeSeconds,
    answer_source: "virtual_ar",
  }));

  const { error: insErr } = await s.from("game_steps").insert(rows);
  if (insErr) throw new Error(`game_steps insert failed: ${insErr.message}`);
}

/** Persist translations dans translations_cache. */
export async function persistTranslations(
  gameId: string,
  translations: TranslationResult[],
) {
  const s = getClient();
  for (const t of translations) {
    // Game-wide fields
    const gameFields: Array<{ key: string; text: string }> = [
      { key: "title", text: t.meta.title },
      { key: "description", text: t.meta.description },
      { key: "intro", text: t.meta.intro },
      { key: "epilogue", text: t.meta.epilogue },
      { key: "epilogue_title", text: t.meta.epilogueTitle },
      { key: "final_riddle_text", text: t.meta.finalRiddleText },
      { key: "final_answer", text: t.meta.finalAnswer },
      { key: "final_answer_explanation", text: t.meta.finalAnswerExplanation },
    ];
    for (const f of gameFields) {
      await s.from("translations_cache").upsert({
        game_id: gameId,
        step_order: null,
        language: t.language,
        field: f.key,
        text: f.text,
        updated_at: new Date().toISOString(),
      }, { onConflict: "game_id,step_order,language,field" });
    }
    // Per-stop fields
    for (const stop of t.stops) {
      const stopFields: Array<{ key: string; text: string }> = [
        { key: "title", text: stop.title },
        { key: "landmark_name", text: stop.landmarkName },
        { key: "riddle_text", text: stop.riddle },
        { key: "anecdote", text: stop.anecdote },
        { key: "ar_character_dialogue", text: stop.arCharacterDialogue },
        { key: "ar_treasure_reward", text: stop.arTreasureReward },
        { key: "hint_0", text: stop.hint },
      ];
      for (const f of stopFields) {
        await s.from("translations_cache").upsert({
          game_id: gameId,
          step_order: stop.step_order,
          language: t.language,
          field: f.key,
          text: f.text,
          updated_at: new Date().toISOString(),
        }, { onConflict: "game_id,step_order,language,field" });
      }
    }
  }
}

/** Persist audios dans audio_cache. */
export async function persistAudios(gameId: string, audios: AudioResult[]) {
  const s = getClient();
  for (const audio of audios) {
    for (const file of audio.files) {
      await s.from("audio_cache").upsert({
        game_id: gameId,
        step_order: file.stepOrder || null,
        language: audio.language,
        slot: file.slot,
        storage_path: file.storagePath,
        public_url: file.publicUrl,
        duration_seconds: file.duration || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "game_id,step_order,language,slot" });
    }
  }
}
