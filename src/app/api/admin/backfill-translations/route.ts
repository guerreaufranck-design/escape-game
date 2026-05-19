/**
 * POST /api/admin/backfill-translations
 *
 * Force la traduction Gemini des champs game-level (intro_speech,
 * final_riddle_text, final_answer_explanation, epilogue_text,
 * epilogue_title, title, description) pour un jeu donné dans une
 * langue cible.
 *
 * Cas d'usage (2026-05-19, bug Montpellier) : Gemini a raté la
 * traduction silencieusement (probable rate-limit ou réponse EN
 * unchanged), et le cache n'a JAMAIS reçu la version FR pour
 * `intro_speech` malgré que les 5 autres champs aient bien été
 * traduits. Le joueur voyait l'intro speech en anglais avec voix
 * robot. Le warmup async côté API joueur (commit 6c6bb77) corrige
 * ça à terme MAIS pour les jeux déjà tournés, on a besoin d'un
 * outil de réparation.
 *
 * Body JSON :
 *   {
 *     "slug": "les-ombres-de-montpellier",
 *     "language": "fr",
 *     "fields": ["intro_speech"]   // optionnel, par défaut tous les game-fields
 *   }
 *
 * Réponse :
 *   {
 *     "success": true,
 *     "gameId": "uuid",
 *     "results": {
 *       "intro_speech": "TRANSLATED" | "ALREADY_CACHED" | "EN_UNCHANGED" | "ERROR: ..."
 *     }
 *   }
 *
 * Auth : le endpoint vit sous /api/admin/ qui est protégé côté
 * middleware. Pas d'auth supplémentaire ici (les autres /admin/
 * routes en GET ne checkent rien non plus côté code, c'est la
 * couche middleware qui gate).
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { translateGameField } from "@/lib/translate-service";

// Local helper — extracts source-language text from JSONB or plain string.
// Same logic as in /api/game/[sessionId]/route.ts ; inlined to avoid a
// new lib file for one private helper.
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

const GAME_LEVEL_FIELDS = [
  "title",
  "description",
  "intro_speech",
  "final_riddle_text",
  "final_answer_explanation",
  "epilogue_title",
  "epilogue_text",
] as const;

type GameLevelField = (typeof GAME_LEVEL_FIELDS)[number];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const slug: string | undefined = body?.slug;
    const gameId: string | undefined = body?.gameId;
    const language: string = body?.language ?? "fr";
    const requestedFields: string[] | undefined = body?.fields;

    if (!slug && !gameId) {
      return NextResponse.json(
        { error: "Provide either 'slug' or 'gameId' in body" },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    // Resolve game by slug if needed
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

    // Fetch all game-level translatable fields
    const { data: game, error: fetchErr } = await supabase
      .from("games")
      .select(
        "id, slug, title, description, intro_speech, final_riddle_text, final_answer_explanation, epilogue_title, epilogue_text",
      )
      .eq("id", resolvedGameId)
      .single();

    if (fetchErr || !game) {
      return NextResponse.json(
        { error: `Game ${resolvedGameId} not found: ${fetchErr?.message}` },
        { status: 404 },
      );
    }

    const fieldsToProcess: GameLevelField[] =
      requestedFields && requestedFields.length > 0
        ? requestedFields.filter((f): f is GameLevelField =>
            GAME_LEVEL_FIELDS.includes(f as GameLevelField),
          )
        : [...GAME_LEVEL_FIELDS];

    const results: Record<string, string> = {};

    for (const field of fieldsToProcess) {
      const val = (game as Record<string, unknown>)[field];
      const enText = getEnglishBase(val);
      if (!enText || enText.trim().length === 0) {
        results[field] = "EMPTY_OR_NULL";
        continue;
      }

      // Check existing cache
      const { data: cached } = await supabase
        .from("translations_cache")
        .select("translated_text")
        .eq("source_id", String(game.id))
        .eq("source_field", field)
        .eq("language", language)
        .maybeSingle();

      if (cached?.translated_text && cached.translated_text !== enText) {
        results[field] = `ALREADY_CACHED (${cached.translated_text.length} chars)`;
        continue;
      }

      // Trigger translation (live Gemini, no cacheOnly). Will write the
      // cache row if Gemini returns a translated text different from EN.
      try {
        const translated = await translateGameField(
          String(game.id),
          "games",
          field,
          enText,
          language,
        );
        if (translated.trim().toLowerCase() === enText.trim().toLowerCase()) {
          results[field] = `EN_UNCHANGED (Gemini returned the source text)`;
        } else {
          results[field] = `TRANSLATED (${translated.length} chars)`;
        }
      } catch (err) {
        results[field] = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
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

// 800s max (Gemini retries jusqu'à ~4 min par field × 7 fields = 28 min worst case,
// mais en pratique la plupart hit le cache ou réussissent au 1er essai).
export const maxDuration = 800;
