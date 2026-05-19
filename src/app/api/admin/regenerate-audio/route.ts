/**
 * POST /api/admin/regenerate-audio
 *
 * Régénère un (ou plusieurs) audio MP3 ElevenLabs pour un jeu donné
 * dans une langue cible. Lit le texte traduit depuis translations_cache,
 * appelle ElevenLabs, uploade dans Supabase Storage, met à jour
 * audio_cache.public_url.
 *
 * Cas d'usage (2026-05-19, suite bug Montpellier intro_speech) :
 *   1. Le texte intro_speech est resté en EN → audio EN généré avec
 *      voix native US.
 *   2. backfill-translations a fixé le texte FR dans translations_cache.
 *   3. Maintenant on doit régénérer le MP3 avec voix FR (ou la voix
 *      multilingual ElevenLabs qui parle FR proprement) pour que
 *      l'audio matche le texte affiché.
 *
 * Body JSON :
 *   {
 *     "slug": "les-ombres-de-montpellier",
 *     "language": "fr",
 *     "slots": ["intro_speech"]   // optionnel, défaut = tous game-wide slots
 *   }
 *
 * Slots supportés actuellement (step_order=0, game-wide) :
 *   - intro_speech, final_riddle, final_explanation, epilogue
 *
 * Réponse :
 *   {
 *     "success": true,
 *     "gameId": "uuid",
 *     "results": {
 *       "intro_speech": "REGENERATED (45123 bytes)" | "NO_TEXT_AVAILABLE" | "ERROR: ..."
 *     }
 *   }
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

// Mapping slot → source_field dans translations_cache (games table)
const SLOT_TO_FIELD: Record<GameWideSlot, string> = {
  intro_speech: "intro_speech",
  final_riddle: "final_riddle_text",
  final_explanation: "final_answer_explanation",
  epilogue: "epilogue_text",
};

// Mapping slot → JSONB column in games table (for EN fallback if cache miss)
const SLOT_TO_GAMES_COLUMN: Record<GameWideSlot, string> = {
  intro_speech: "intro_speech",
  final_riddle: "final_riddle_text",
  final_explanation: "final_answer_explanation",
  epilogue: "epilogue_text",
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const slug: string | undefined = body?.slug;
    const gameId: string | undefined = body?.gameId;
    const language: string = body?.language ?? "fr";
    const requestedSlots: string[] | undefined = body?.slots;

    if (!slug && !gameId) {
      return NextResponse.json(
        { error: "Provide either 'slug' or 'gameId' in body" },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    let resolvedGameId = gameId;
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

    // Fetch the game's JSONB columns (used as EN fallback if cache miss)
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

    const slotsToProcess: GameWideSlot[] =
      requestedSlots && requestedSlots.length > 0
        ? requestedSlots.filter((s): s is GameWideSlot =>
            GAME_WIDE_SLOTS.includes(s as GameWideSlot),
          )
        : [...GAME_WIDE_SLOTS];

    const results: Record<string, string> = {};

    for (const slot of slotsToProcess) {
      const sourceField = SLOT_TO_FIELD[slot];
      const gamesColumn = SLOT_TO_GAMES_COLUMN[slot];

      // Priority 1 : cached translation in the target language
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

      // Priority 2 : EN fallback from games JSONB column
      if (!text) {
        const en = getEnglishBase((game as Record<string, unknown>)[gamesColumn]);
        if (en.trim()) {
          text = en;
        }
      }

      if (!text) {
        results[slot] = "NO_TEXT_AVAILABLE";
        continue;
      }

      // Pick voice : game-wide narration uses the default "guide" voice
      // (Dallin / language override). Pas de character archetype ici car
      // c'est la voix neutre du guide narrateur.
      const voiceId = voiceFor(undefined, language) || DEFAULT_VOICE_ID;
      const storagePath = buildAudioPath(String(game.id), language, 0, slot);

      try {
        const { publicUrl, byteSize } = await generateAndStoreAudio({
          text,
          voiceId,
          storagePath,
        });

        // Upsert audio_cache row
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
          results[slot] = `STORAGE_OK_DB_FAIL: ${upsertErr.message}`;
        } else {
          results[slot] = `REGENERATED (${byteSize} bytes, voice=${voiceId})`;
        }
      } catch (err) {
        results[slot] = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
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

// ElevenLabs Flash v2.5 → ~250-1000ms par appel. 4 slots × 1s + upload S3 +
// DB upsert = quelques secondes max. 800s suffit largement.
export const maxDuration = 800;
