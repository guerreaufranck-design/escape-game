/**
 * PERSIST v5 — fonctions DB séparées, une par étape Inngest.
 *
 * Chaque fonction est :
 *   - idempotente (peut être rejouée sans casser)
 *   - rapide (< 5s — pas de logique métier)
 *   - cleanly typée
 *
 * Le but : chaque step.run() dans build-game-v2.ts appelle UNE de ces
 * fonctions. Pas de mélange avec discover/geocode/select/narrate.
 */

import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "./config";
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

// ─────────────────────────────────────────────────────────────
// STEP 1 — Insert empty game (avant tout)
// ─────────────────────────────────────────────────────────────

/** Crée une ligne games minimale avec is_published=false + start_point_source=pipeline_v2.
 *  Le cron process-pending-games doit IGNORER les rows avec ce flag. */
export async function insertEmptyGame(input: PipelineInput): Promise<string> {
  const s = getClient();
  const { data, error } = await s
    .from("games")
    .insert({
      slug: input.slug,
      title: input.theme,
      description: input.themeDescription ?? "(en cours de génération via pipeline v5)",
      city: input.city,
      difficulty: input.difficulty,
      estimated_duration_min: input.estimatedDurationMin,
      mode: input.mode,
      transport_mode: input.transportMode,
      radius_km: input.radiusKm,
      start_point_lat: input.startPoint.lat,
      start_point_lon: input.startPoint.lon,
      start_point_text: input.startPointText ?? null,
      start_point_source: CONFIG.PIPELINE_VERSION_TAG,
      is_published: false,
      needs_review: false,
      original_payload: input.originalPayload,
      product_description: input.productDescription ?? null,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertEmptyGame: ${error.message}`);
  return data.id as string;
}

// ─────────────────────────────────────────────────────────────
// STEP 5 — Persist master EN (game meta + game_steps)
// ─────────────────────────────────────────────────────────────

export async function persistMasterEN(
  gameId: string,
  input: PipelineInput,
  game: StructuredGame,
): Promise<void> {
  const s = getClient();

  // 1. UPDATE games meta
  const { error: gErr } = await s
    .from("games")
    .update({
      title: game.meta.title,
      description: game.meta.description,
      intro_speech: game.meta.intro,
      epilogue_title: game.meta.epilogueTitle,
      epilogue_text: game.meta.epilogue,
      final_riddle_text: game.meta.finalRiddleText,
      final_answer: game.meta.finalAnswer,
      final_answer_explanation: game.meta.finalAnswerExplanation,
      updated_at: new Date().toISOString(),
    })
    .eq("id", gameId);
  if (gErr) throw new Error(`persistMasterEN games update: ${gErr.message}`);

  // 2. DELETE then INSERT game_steps (idempotent)
  const { error: dErr } = await s.from("game_steps").delete().eq("game_id", gameId);
  if (dErr) throw new Error(`persistMasterEN delete steps: ${dErr.message}`);

  const rows = game.stops.map((stop) => ({
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

  const { error: iErr } = await s.from("game_steps").insert(rows);
  if (iErr) throw new Error(`persistMasterEN insert steps: ${iErr.message}`);
}

// ─────────────────────────────────────────────────────────────
// STEP 6/7 — Persist translation (langue client si != EN)
// ─────────────────────────────────────────────────────────────

/** Upsert translations_cache si la table le supporte. Non-bloquant en cas d'erreur schema. */
export async function persistTranslation(
  gameId: string,
  translation: TranslationResult,
): Promise<void> {
  const s = getClient();

  const writes: Array<{ field: string; step_order: number | null; text: string }> = [
    { field: "title", step_order: null, text: translation.meta.title },
    { field: "description", step_order: null, text: translation.meta.description },
    { field: "intro", step_order: null, text: translation.meta.intro },
    { field: "epilogue", step_order: null, text: translation.meta.epilogue },
    { field: "epilogue_title", step_order: null, text: translation.meta.epilogueTitle },
    { field: "final_riddle_text", step_order: null, text: translation.meta.finalRiddleText },
    { field: "final_answer", step_order: null, text: translation.meta.finalAnswer },
    { field: "final_answer_explanation", step_order: null, text: translation.meta.finalAnswerExplanation },
  ];
  for (const stop of translation.stops) {
    writes.push(
      { field: "title", step_order: stop.step_order, text: stop.title },
      { field: "landmark_name", step_order: stop.step_order, text: stop.landmarkName },
      { field: "riddle_text", step_order: stop.step_order, text: stop.riddle },
      { field: "anecdote", step_order: stop.step_order, text: stop.anecdote },
      { field: "ar_character_dialogue", step_order: stop.step_order, text: stop.arCharacterDialogue },
      { field: "ar_treasure_reward", step_order: stop.step_order, text: stop.arTreasureReward },
      { field: "hint_0", step_order: stop.step_order, text: stop.hint },
    );
  }

  let okCount = 0;
  let errCount = 0;
  for (const w of writes) {
    const { error } = await s.from("translations_cache").upsert(
      {
        game_id: gameId,
        step_order: w.step_order,
        language: translation.language,
        field: w.field,
        text: w.text,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "game_id,step_order,language,field" },
    );
    if (error) errCount++;
    else okCount++;
  }
  if (errCount > 0) {
    console.warn(`[v5 persist] translations_cache: ${okCount} ok, ${errCount} errors (schema mismatch likely — non-blocking)`);
  }
}

// ─────────────────────────────────────────────────────────────
// STEP 8 — Persist audios (chemin Storage + cache)
// ─────────────────────────────────────────────────────────────

export async function persistAudios(gameId: string, audio: AudioResult): Promise<void> {
  const s = getClient();
  let errors = 0;
  for (const f of audio.files) {
    const { error } = await s.from("audio_cache").upsert(
      {
        game_id: gameId,
        step_order: f.stepOrder || null,
        language: audio.language,
        slot: f.slot,
        storage_path: f.storagePath,
        public_url: f.publicUrl,
        byte_size: f.duration ? null : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "game_id,step_order,language,slot" },
    );
    if (error) errors++;
  }
  if (errors > 0) console.warn(`[v5 persist] audio_cache : ${errors} errors`);
}

// ─────────────────────────────────────────────────────────────
// STEP 9 — Create activation code
// ─────────────────────────────────────────────────────────────

export async function createActivationCode(
  gameId: string,
  input: PipelineInput,
): Promise<string> {
  const s = getClient();
  const cityPart = input.slug.slice(0, 4).toUpperCase();
  const r1 = Math.random().toString(36).slice(2, 6).toUpperCase();
  const r2 = Math.random().toString(36).slice(2, 6).toUpperCase();
  const code = `${cityPart}-${r1}-${r2}`;
  const expires = new Date(Date.now() + CONFIG.CODE_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
  const { error } = await s.from("activation_codes").insert({
    code,
    game_id: gameId,
    team_name: input.buyerEmail?.split("@")[0] ?? "Buyer",
    expires_at: expires.toISOString(),
    is_single_use: true,
    max_uses: 1,
  });
  if (error) throw new Error(`createActivationCode: ${error.message}`);
  return code;
}

// ─────────────────────────────────────────────────────────────
// STEP 10 — Publish game
// ─────────────────────────────────────────────────────────────

export async function publishGame(gameId: string): Promise<void> {
  const s = getClient();
  const { error } = await s
    .from("games")
    .update({ is_published: true, needs_review: false, updated_at: new Date().toISOString() })
    .eq("id", gameId);
  if (error) throw new Error(`publishGame: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────
// STEP 11 — Callback OddballTrip
// ─────────────────────────────────────────────────────────────

export async function notifyOddballTrip(
  input: PipelineInput,
  gameId: string,
  code: string,
): Promise<void> {
  if (!input.callbackUrl || !input.callbackSecret) return;
  try {
    const res = await fetch(input.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.callbackSecret}`,
      },
      body: JSON.stringify({
        slug: input.slug,
        gameId,
        code,
        orderId: input.orderId,
        language: input.language,
      }),
    });
    if (!res.ok) {
      console.warn(`[v5 callback] OddballTrip non-2xx: ${res.status}`);
    }
  } catch (e) {
    console.warn(`[v5 callback] failed (non-blocking): ${e instanceof Error ? e.message : "?"}`);
  }
}

// ─────────────────────────────────────────────────────────────
// HALT — set needs_review on game (en cas d'échec de l'un des steps)
// ─────────────────────────────────────────────────────────────

export async function haltForReview(gameId: string, reason: string): Promise<void> {
  const s = getClient();
  await s
    .from("games")
    .update({
      is_published: false,
      needs_review: true,
      review_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", gameId);
}
