/**
 * Auto-rectify action catalogue (Sprint 6.1, 2026-05-21).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Purpose
 * ═══════════════════════════════════════════════════════════════════
 *
 * Maps a classified error category → a typed, reversible action that
 * the system can apply automatically.
 *
 * The classifier (lib/error-report-classifier.ts) produces a category.
 * The rectifier router (this file) dispatches to the right action.
 * Every action :
 *   - records a `before_state` snapshot in `auto_rectification_log`
 *   - applies the fix
 *   - records the `after_state`
 *   - returns a typed result so the caller knows what happened
 *
 * If the fix fails or the situation is too ambiguous, the action
 * returns `applied: false` with a reason — the caller then flags
 * the incident for admin review instead.
 *
 * ═══════════════════════════════════════════════════════════════════
 * Sprint 6.1 scope
 * ═══════════════════════════════════════════════════════════════════
 *
 * Only AUDIO actions ship in 6.1 :
 *   - rectifyMissingAudio        : missing slot → generate
 *   - rectifyAudioTextMismatch   : audio doesn't match current text →
 *                                  delete + regenerate
 *
 * Both actions are LOW RISK because :
 *   - audio is generated from the displayed text, so regenerating just
 *     aligns the audio to whatever is currently in the DB
 *   - failure mode is bounded (audio plays incorrectly OR doesn't play)
 *   - cost is < $0.05 per regen (ElevenLabs Flash v2.5)
 *
 * GPS, answer-variant, hint-extension, translation rectifiers ship in
 * Sprint 6.2 / 6.4.
 */
import { createAdminClient } from "./supabase/admin";
import {
  generateAndStoreAudio,
  buildAudioPath,
  DEFAULT_VOICE_ID,
} from "./elevenlabs";
import type { ErrorCategory } from "./error-report-classifier";

// ════════════════════════════════════════════════════════════════════
// Types — typed actions that operators (or the auto-system) execute
// ════════════════════════════════════════════════════════════════════

export type OperatorAction =
  | {
      type: "rectifyMissingAudio";
      gameId: string;
      stepId: string;
      stepOrder: number;
      language: string;
      slot: AudioSlot;
    }
  | {
      type: "rectifyAudioTextMismatch";
      gameId: string;
      stepId: string;
      stepOrder: number;
      language: string;
      // Caller may know which slot; if null we regen all step slots
      slot: AudioSlot | "all_step_slots";
    }
  | {
      type: "rectifyWrongGps";
      // Sprint 6.2 — placeholder for the type so the rectifier router
      // can route to it. Implementation lives in another file by then.
      stepId: string;
    }
  | {
      type: "rectifyCannotFindLandmark";
      // Sprint 6.2 — placeholder
      stepId: string;
    };

export type AudioSlot =
  | "character"
  | "anecdote"
  | "epilogue"
  | "riddle"
  | "landmark_history"
  | "intro_speech"
  | "final_riddle"
  | "final_explanation";

export interface ActionResult {
  applied: boolean;
  /** When applied=true : the action_type executed. */
  action_type?: string;
  /** When applied=false : the reason for abstaining. */
  reason?: string;
  /** Logged via auto_rectification_log.id for reversibility. */
  rectification_log_id?: string;
  /** Detail for the operator log. */
  detail?: Record<string, unknown>;
}

// ════════════════════════════════════════════════════════════════════
// Router — pick rectifier for a category
// ════════════════════════════════════════════════════════════════════

/**
 * Map a classified category to the canonical action_type. Used by the
 * Inngest classify-and-rectify function to know which rectifier to
 * call. Categories with "admin" disposition return null — the caller
 * routes those to the admin queue instead.
 */
export function routeCategoryToActionType(
  category: ErrorCategory,
): OperatorAction["type"] | null {
  switch (category) {
    // ── Sprint 6.1 (shipping now) ──
    case "missing_audio":
      return "rectifyMissingAudio";
    case "audio_text_mismatch":
      return "rectifyAudioTextMismatch";
    // ── Sprint 6.2 (placeholder, returns null in 6.1) ──
    case "wrong_gps":
    case "cannot_find_landmark":
      // Sprint 6.2 will activate these. For 6.1 we route to admin.
      return null;
    // ── Sprint 6.4 (always admin until then) ──
    case "wrong_answer_rejected":
    case "riddle_too_hard_or_unclear":
    case "translation_error":
      return null;
    // ── Always admin ──
    case "wrong_answer_accepted":
    case "ar_overlay_broken":
    case "factual_error":
    case "narrative_inconsistency":
    case "other":
    default:
      return null;
  }
}

// ════════════════════════════════════════════════════════════════════
// Action implementations
// ════════════════════════════════════════════════════════════════════

interface ApplyContext {
  /** Pipeline incident id (used as foreign key in auto_rectification_log). */
  incidentId: string;
}

/**
 * Dispatcher — typed action → implementation. Throws if action type
 * isn't implemented in current sprint.
 */
export async function applyAction(
  action: OperatorAction,
  ctx: ApplyContext,
): Promise<ActionResult> {
  switch (action.type) {
    case "rectifyMissingAudio":
      return rectifyMissingAudio(action, ctx);
    case "rectifyAudioTextMismatch":
      return rectifyAudioTextMismatch(action, ctx);
    case "rectifyWrongGps":
    case "rectifyCannotFindLandmark":
      // Sprint 6.2 placeholders. Should be unreachable in 6.1 because
      // router returns null for these categories.
      return {
        applied: false,
        reason: `${action.type} not yet implemented (Sprint 6.2)`,
      };
  }
}

/**
 * Regenerate the audio MP3 for one (game, step, language, slot).
 *
 * Reads the displayed text from the relevant DB column, calls
 * ElevenLabs, uploads to Supabase Storage, upserts audio_cache row.
 *
 * Reversibility : the previous audio file is overwritten in Storage,
 * but the old `audio_cache` row's public_url is the SAME (we use
 * upsert with onConflict). So the "revert" semantics for audio is
 * "re-run from the old text" — operator would have to provide it
 * manually. For Sprint 6.1 we accept this limitation : audio is
 * regenerable from the current DB text at any time, so no real loss.
 */
async function rectifyMissingAudio(
  action: Extract<OperatorAction, { type: "rectifyMissingAudio" }>,
  ctx: ApplyContext,
): Promise<ActionResult> {
  const supabase = createAdminClient();

  // 1. Check that the slot is actually missing (idempotent guard).
  const { data: existing } = await supabase
    .from("audio_cache")
    .select("id, public_url")
    .eq("game_id", action.gameId)
    .eq("language", action.language)
    .eq("slot", action.slot)
    .eq("step_order", action.stepOrder)
    .maybeSingle();

  if (existing) {
    return {
      applied: false,
      reason: "Audio already exists for this slot — nothing to rectify",
      detail: { existing_url: existing.public_url },
    };
  }

  // 2. Fetch the text to narrate from the right DB column.
  const text = await fetchSlotText(action.gameId, action.stepId, action.slot, action.language);
  if (!text || text.trim().length < 10) {
    return {
      applied: false,
      reason: `Slot text empty or too short (${text?.length ?? 0} chars) — cannot generate audio`,
    };
  }

  // 3. Generate via ElevenLabs + upload
  const storagePath = buildAudioPath(action.gameId, action.language, action.stepOrder, action.slot);
  let generated: { publicUrl: string; byteSize: number };
  try {
    generated = await generateAndStoreAudio({
      text,
      voiceId: DEFAULT_VOICE_ID,
      storagePath,
    });
  } catch (err) {
    return {
      applied: false,
      reason: `ElevenLabs generation failed : ${err instanceof Error ? err.message : err}`,
    };
  }

  // 4. Upsert audio_cache row
  const { error: upsertErr } = await supabase.from("audio_cache").upsert(
    {
      game_id: action.gameId,
      language: action.language,
      slot: action.slot,
      step_order: action.stepOrder,
      storage_path: storagePath,
      public_url: generated.publicUrl,
      byte_size: generated.byteSize,
    },
    { onConflict: "game_id,language,slot,step_order" },
  );

  if (upsertErr) {
    return {
      applied: false,
      reason: `audio_cache upsert failed : ${upsertErr.message}`,
    };
  }

  // 5. Log to auto_rectification_log for reversibility audit
  const { data: log } = await supabase
    .from("auto_rectification_log")
    .insert({
      incident_id: ctx.incidentId,
      game_id: action.gameId,
      step_id: action.stepId,
      action_type: "rectifyMissingAudio",
      before_state: { audio_cache_row: null },
      after_state: {
        audio_cache_row: {
          slot: action.slot,
          step_order: action.stepOrder,
          public_url: generated.publicUrl,
          byte_size: generated.byteSize,
        },
      },
    })
    .select("id")
    .single();

  return {
    applied: true,
    action_type: "rectifyMissingAudio",
    rectification_log_id: log?.id,
    detail: {
      slot: action.slot,
      step_order: action.stepOrder,
      byte_size: generated.byteSize,
    },
  };
}

/**
 * Audio doesn't match the displayed text → delete the existing audio
 * row and regenerate from the current DB text.
 *
 * Why this works : the displayed text IS the source of truth. If
 * someone edited the riddle/anecdote/landmark_history text in the
 * DB (e.g. fixed a Roman numeral, corrected a date), the cached audio
 * still narrates the OLD text. Regenerating syncs them.
 *
 * If `slot === "all_step_slots"` we regen all 4 step slots (riddle,
 * anecdote, landmark_history, character). Useful when the player
 * doesn't know which slot was wrong.
 */
async function rectifyAudioTextMismatch(
  action: Extract<OperatorAction, { type: "rectifyAudioTextMismatch" }>,
  ctx: ApplyContext,
): Promise<ActionResult> {
  const supabase = createAdminClient();

  const slotsToRegen: AudioSlot[] = action.slot === "all_step_slots"
    ? ["riddle", "anecdote", "landmark_history", "character"]
    : [action.slot];

  // Snapshot existing audio_cache rows BEFORE deletion (for revert log)
  const { data: beforeRows } = await supabase
    .from("audio_cache")
    .select("slot, public_url, byte_size, storage_path")
    .eq("game_id", action.gameId)
    .eq("language", action.language)
    .eq("step_order", action.stepOrder)
    .in("slot", slotsToRegen);

  const regenerated: Array<{ slot: AudioSlot; byteSize: number; publicUrl: string }> = [];
  const failed: Array<{ slot: AudioSlot; reason: string }> = [];

  for (const slot of slotsToRegen) {
    const text = await fetchSlotText(action.gameId, action.stepId, slot, action.language);
    if (!text || text.trim().length < 10) {
      failed.push({ slot, reason: "text empty or too short" });
      continue;
    }
    const storagePath = buildAudioPath(action.gameId, action.language, action.stepOrder, slot);
    try {
      const result = await generateAndStoreAudio({
        text,
        voiceId: DEFAULT_VOICE_ID,
        storagePath,
      });
      // Upsert (replaces old row in audio_cache)
      await supabase.from("audio_cache").upsert(
        {
          game_id: action.gameId,
          language: action.language,
          slot,
          step_order: action.stepOrder,
          storage_path: storagePath,
          public_url: result.publicUrl,
          byte_size: result.byteSize,
        },
        { onConflict: "game_id,language,slot,step_order" },
      );
      regenerated.push({ slot, byteSize: result.byteSize, publicUrl: result.publicUrl });
    } catch (err) {
      failed.push({ slot, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  if (regenerated.length === 0) {
    return {
      applied: false,
      reason: `All ${slotsToRegen.length} regen attempts failed : ${failed.map((f) => `${f.slot}=${f.reason}`).join("; ")}`,
    };
  }

  // Log to auto_rectification_log
  const { data: log } = await supabase
    .from("auto_rectification_log")
    .insert({
      incident_id: ctx.incidentId,
      game_id: action.gameId,
      step_id: action.stepId,
      action_type: "rectifyAudioTextMismatch",
      before_state: { audio_cache_rows: beforeRows ?? [] },
      after_state: { regenerated, failed },
    })
    .select("id")
    .single();

  return {
    applied: true,
    action_type: "rectifyAudioTextMismatch",
    rectification_log_id: log?.id,
    detail: {
      slots_regenerated: regenerated.map((r) => r.slot),
      slots_failed: failed.map((f) => f.slot),
      total_bytes: regenerated.reduce((s, r) => s + r.byteSize, 0),
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════

/**
 * Read the text source for a given (game, step, slot, language).
 *
 * Game-level slots (intro_speech, epilogue, final_riddle, final_explanation)
 * read from `games` table. Step-level slots (riddle, anecdote,
 * landmark_history, character) read from `game_steps`.
 *
 * Translation : if language ≠ source language (typically 'en'), check
 * `translations_cache` first; if no row, fall back to source-language
 * text. Caller (auto-rectifier) treats the fallback case as
 * "translation_error" if it cares.
 */
async function fetchSlotText(
  gameId: string,
  stepId: string,
  slot: AudioSlot,
  language: string,
): Promise<string | null> {
  const supabase = createAdminClient();

  // Game-level slots
  const gameLevel: AudioSlot[] = [
    "intro_speech",
    "epilogue",
    "final_riddle",
    "final_explanation",
  ];
  if (gameLevel.includes(slot)) {
    const fieldMap: Record<string, string> = {
      intro_speech: "intro_speech",
      epilogue: "epilogue_text",
      final_riddle: "final_riddle_text",
      final_explanation: "final_answer_explanation",
    };
    const field = fieldMap[slot];
    // Try translation cache first
    const { data: trans } = await supabase
      .from("translations_cache")
      .select("translated_text")
      .eq("source_table", "games")
      .eq("source_id", gameId)
      .eq("source_field", field)
      .eq("language", language)
      .maybeSingle();
    if (trans?.translated_text) return trans.translated_text;
    // Fallback to source (assumed English)
    const { data: game } = await supabase
      .from("games")
      .select(field)
      .eq("id", gameId)
      .single();
    if (!game) return null;
    const raw = (game as unknown as Record<string, unknown>)[field];
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, string>;
      return obj[language] || obj.en || Object.values(obj)[0] || null;
    }
    return null;
  }

  // Step-level slots
  const stepFieldMap: Record<string, string> = {
    riddle: "riddle_text",
    anecdote: "anecdote",
    landmark_history: "landmark_history",
    character: "ar_character_dialogue",
  };
  const stepField = stepFieldMap[slot];
  if (!stepField) return null;

  // Translation cache first
  const { data: trans } = await supabase
    .from("translations_cache")
    .select("translated_text")
    .eq("source_table", "game_steps")
    .eq("source_id", stepId)
    .eq("source_field", stepField)
    .eq("language", language)
    .maybeSingle();
  if (trans?.translated_text) return trans.translated_text;

  // Fallback to source
  const { data: step } = await supabase
    .from("game_steps")
    .select(stepField)
    .eq("id", stepId)
    .single();
  if (!step) return null;
  const raw = (step as unknown as Record<string, unknown>)[stepField];
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, string>;
    return obj[language] || obj.en || Object.values(obj)[0] || null;
  }
  return null;
}
