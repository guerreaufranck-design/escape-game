/**
 * POST /api/admin/regenerate-audio
 *
 * Régénère un (ou plusieurs) audio MP3 ElevenLabs pour un jeu donné
 * dans une langue cible. Couvre :
 *
 *   1. Game-wide slots (step_order=0) :
 *      intro_speech, final_riddle, final_explanation, epilogue
 *   2. Per-step slots (step_order=1..N) :
 *      riddle, character, anecdote, landmark_history
 *
 * Cas d'usage typiques :
 *
 *   a) Texte retraduit → audio à régénérer :
 *      Après un backfill-translations sur intro_speech, l'audio
 *      reste sur l'ancien texte. Cet endpoint regénère le MP3.
 *
 *   b) Storage path corrompu (bug Montpellier 2026-05-19) :
 *      Le pipeline a écrit le mauvais storage_path pour une row
 *      audio_cache (e.g. step1 pointait sur step7_landmark_history.mp3).
 *      Le ré-upload force le bon path déterministe via buildAudioPath.
 *
 * Body JSON :
 *   {
 *     "slug": "les-ombres-de-montpellier",
 *     "language": "fr",
 *     // Optionnel — au moins un des deux requis
 *     "slots": ["intro_speech"],
 *     "steps": [
 *       { "step_order": 1, "slots": ["landmark_history"] },
 *       { "step_order": 7, "slots": ["riddle", "anecdote"] }
 *     ]
 *   }
 *
 * Si seul `slots` est fourni : régénère les game-wide slots (step_order=0).
 * Si seul `steps` est fourni : régénère les per-step slots.
 * Si les deux : les deux sont traités.
 *
 * Réponse : carte des résultats par slot/step.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateAndStoreAudio, buildAudioPath, DEFAULT_VOICE_ID } from "@/lib/elevenlabs";
import { voiceFor } from "@/lib/voice-map";

// Game-wide slots (step_order=0) accepted by this endpoint
const GAME_WIDE_SLOTS = [
  "intro_speech",
  "final_riddle",
  "final_explanation",
  "epilogue",
] as const;

type GameWideSlot = (typeof GAME_WIDE_SLOTS)[number];

// Per-step slots (step_order=1..N)
const PER_STEP_SLOTS = [
  "riddle",
  "character",
  "anecdote",
  "landmark_history",
] as const;

type PerStepSlot = (typeof PER_STEP_SLOTS)[number];

// Mapping slot → source_field dans translations_cache (games table, game-wide)
const SLOT_TO_FIELD: Record<GameWideSlot, string> = {
  intro_speech: "intro_speech",
  final_riddle: "final_riddle_text",
  final_explanation: "final_answer_explanation",
  epilogue: "epilogue_text",
};

const SLOT_TO_GAMES_COLUMN: Record<GameWideSlot, string> = {
  intro_speech: "intro_speech",
  final_riddle: "final_riddle_text",
  final_explanation: "final_answer_explanation",
  epilogue: "epilogue_text",
};

// Mapping per-step slot → game_steps column (JSONB or plain string)
const PER_STEP_SLOT_TO_COLUMN: Record<PerStepSlot, string> = {
  riddle: "riddle_text",
  character: "ar_character_dialogue",
  anecdote: "anecdote",
  landmark_history: "landmark_history",
};

function getEnglishBase(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") {
    if (value.startsWith("{") && value.includes('"')) {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === "object" && parsed !== null) {
          return parsed.en || parsed.fr || Object.values(parsed)[0] || value;
        }
      } catch {
        /* not JSON */
      }
    }
    return value;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, string>;
    return obj.en || obj.fr || Object.values(obj)[0] || "";
  }
  return String(value);
}

interface PerStepInput {
  step_order: number;
  slots: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const slug: string | undefined = body?.slug;
    const gameIdInput: string | undefined = body?.gameId;
    const language: string = body?.language ?? "fr";
    const requestedGameWideSlots: string[] | undefined = body?.slots;
    const requestedSteps: PerStepInput[] | undefined = body?.steps;

    if (!slug && !gameIdInput) {
      return NextResponse.json(
        { error: "Provide either 'slug' or 'gameId' in body" },
        { status: 400 },
      );
    }
    if (!requestedGameWideSlots && !requestedSteps) {
      return NextResponse.json(
        { error: "Provide at least one of 'slots' (game-wide) or 'steps' (per-step)" },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    let resolvedGameId = gameIdInput;
    if (!resolvedGameId && slug) {
      const { data: game } = await supabase
        .from("games")
        .select("id")
        .eq("slug", slug)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (!game) {
        return NextResponse.json(
          { error: `No game found for slug=${slug}` },
          { status: 404 },
        );
      }
      resolvedGameId = game.id;
    }

    const { data: game, error: gameErr } = await supabase
      .from("games")
      .select(
        "id, slug, intro_speech, final_riddle_text, final_answer_explanation, epilogue_text",
      )
      .eq("id", resolvedGameId)
      .single();
    if (gameErr || !game) {
      return NextResponse.json(
        { error: `Game ${resolvedGameId} not found: ${gameErr?.message}` },
        { status: 404 },
      );
    }

    const results: Record<string, string> = {};

    // ─────────────────────────────────────────────
    // PASS 1 — game-wide slots (step_order=0)
    // ─────────────────────────────────────────────
    if (requestedGameWideSlots && requestedGameWideSlots.length > 0) {
      const validSlots: GameWideSlot[] = requestedGameWideSlots.filter(
        (s): s is GameWideSlot => GAME_WIDE_SLOTS.includes(s as GameWideSlot),
      );

      for (const slot of validSlots) {
        const sourceField = SLOT_TO_FIELD[slot];
        const gamesColumn = SLOT_TO_GAMES_COLUMN[slot];

        let text: string | null = null;
        if (language !== "en") {
          const { data: cached } = await supabase
            .from("translations_cache")
            .select("translated_text")
            .eq("source_id", String(game.id))
            .eq("source_field", sourceField)
            .eq("language", language)
            .maybeSingle();
          if (cached?.translated_text) {
            text = cached.translated_text as string;
          }
        }
        if (!text) {
          const en = getEnglishBase((game as Record<string, unknown>)[gamesColumn]);
          if (en.trim()) text = en;
        }

        if (!text) {
          results[`gamewide:${slot}`] = "NO_TEXT_AVAILABLE";
          continue;
        }

        const voiceId = voiceFor(undefined, language) || DEFAULT_VOICE_ID;
        const storagePath = buildAudioPath(String(game.id), language, 0, slot);

        try {
          const { publicUrl, byteSize } = await generateAndStoreAudio({
            text,
            voiceId,
            storagePath,
          });
          const { error: upsertErr } = await supabase.from("audio_cache").upsert(
            {
              game_id: String(game.id),
              step_order: 0,
              language,
              slot,
              storage_path: storagePath,
              public_url: publicUrl,
              byte_size: byteSize,
            },
            { onConflict: "game_id,step_order,language,slot" },
          );
          if (upsertErr) {
            results[`gamewide:${slot}`] = `STORAGE_OK_DB_FAIL: ${upsertErr.message}`;
          } else {
            results[`gamewide:${slot}`] = `REGENERATED (${byteSize} bytes, voice=${voiceId})`;
          }
        } catch (err) {
          results[`gamewide:${slot}`] = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }

    // ─────────────────────────────────────────────
    // PASS 2 — per-step slots (step_order=1..N)
    // ─────────────────────────────────────────────
    if (requestedSteps && requestedSteps.length > 0) {
      for (const stepInput of requestedSteps) {
        const stepOrder = stepInput.step_order;
        if (!Number.isInteger(stepOrder) || stepOrder < 1) {
          results[`step${stepOrder}:invalid`] = "INVALID_STEP_ORDER";
          continue;
        }

        // Fetch the game_step row for this step
        const { data: stepRow, error: stepErr } = await supabase
          .from("game_steps")
          .select(
            "id, step_order, riddle_text, ar_character_dialogue, ar_character_type, anecdote, landmark_history",
          )
          .eq("game_id", game.id)
          .eq("step_order", stepOrder)
          .single();
        if (stepErr || !stepRow) {
          results[`step${stepOrder}:fetch`] = `STEP_NOT_FOUND: ${stepErr?.message ?? "no row"}`;
          continue;
        }

        const validSlots: PerStepSlot[] = stepInput.slots.filter(
          (s): s is PerStepSlot => PER_STEP_SLOTS.includes(s as PerStepSlot),
        );

        for (const slot of validSlots) {
          const column = PER_STEP_SLOT_TO_COLUMN[slot];

          // Priority 1 : per-step translations_cache (source_table='game_steps')
          let text: string | null = null;
          if (language !== "en") {
            const { data: cached } = await supabase
              .from("translations_cache")
              .select("translated_text")
              .eq("source_id", String(stepRow.id))
              .eq("source_field", column)
              .eq("language", language)
              .maybeSingle();
            if (cached?.translated_text) {
              text = cached.translated_text as string;
            }
          }

          // Priority 2 : EN base from game_steps column (JSONB or plain)
          if (!text) {
            const en = getEnglishBase(
              (stepRow as Record<string, unknown>)[column],
            );
            if (en.trim()) text = en;
          }

          if (!text) {
            results[`step${stepOrder}:${slot}`] = "NO_TEXT_AVAILABLE";
            continue;
          }

          // Pick voice : for character slot, use the character archetype
          // assigned to this step. For others (riddle, anecdote,
          // landmark_history), use the neutral guide voice.
          const voiceId =
            slot === "character"
              ? voiceFor(stepRow.ar_character_type ?? null, language) ||
                DEFAULT_VOICE_ID
              : voiceFor(undefined, language) || DEFAULT_VOICE_ID;

          const storagePath = buildAudioPath(
            String(game.id),
            language,
            stepOrder,
            slot,
          );

          try {
            const { publicUrl, byteSize } = await generateAndStoreAudio({
              text,
              voiceId,
              storagePath,
            });
            const { error: upsertErr } = await supabase
              .from("audio_cache")
              .upsert(
                {
                  game_id: String(game.id),
                  step_order: stepOrder,
                  language,
                  slot,
                  storage_path: storagePath,
                  public_url: publicUrl,
                  byte_size: byteSize,
                },
                { onConflict: "game_id,step_order,language,slot" },
              );
            if (upsertErr) {
              results[`step${stepOrder}:${slot}`] = `STORAGE_OK_DB_FAIL: ${upsertErr.message}`;
            } else {
              results[`step${stepOrder}:${slot}`] = `REGENERATED (${byteSize} bytes, voice=${voiceId})`;
            }
          } catch (err) {
            results[`step${stepOrder}:${slot}`] = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      gameId: game.id,
      slug: game.slug,
      language,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const maxDuration = 800;
