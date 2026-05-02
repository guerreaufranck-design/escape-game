import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  validateApiKey,
  generateActivationCode,
  corsHeaders,
} from "@/lib/external-auth";
import { sendCodeGenerationFailureAlert } from "@/lib/email";
import { prepareGamePackage } from "@/lib/game-package";

/**
 * Pre-generation of text + audio takes 30-60s for one new (game × lang).
 * Vercel default function timeout is 10s on Hobby, 60s on Pro. Bump to
 * 5 minutes — synchronous flow lets the merchant know everything is
 * ready before they email the customer.
 */
export const maxDuration = 300;

/**
 * OPTIONS /api/external/generate-code
 * Handle CORS preflight requests.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/** Extract plain text from a title that may be a JSONB object or string */
function extractTitle(title: unknown, lang = "en"): string {
  if (typeof title === "string") {
    try {
      const parsed = JSON.parse(title);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed[lang] || parsed.en || parsed.fr || Object.values(parsed)[0] || title;
      }
    } catch {
      // Not JSON, use as-is
    }
    return title;
  }
  if (typeof title === "object" && title !== null) {
    const obj = title as Record<string, string>;
    return obj[lang] || obj.en || obj.fr || Object.values(obj)[0] || "";
  }
  return String(title || "");
}

/**
 * POST /api/external/generate-code
 * Called by oddballtrip.com after a purchase to generate an activation code.
 *
 * Headers:
 *   Authorization: Bearer {EXTERNAL_API_SECRET}
 *
 * Body:
 *   {
 *     gameId: string,                 // required
 *     buyerEmail: string,             // required
 *     buyerName?: string,
 *     orderId?: string,
 *     language?: string               // 2-letter ISO code (fr|en|de|es|it|pt|...|ja|ko|zh|...)
 *                                     // If provided, app pre-generates text translations + ElevenLabs audio
 *                                     // for this game in this language. Adds 30-60s to the response on the
 *                                     // first sale of a (game × language) pair (cached forever after).
 *   }
 *
 * Returns:
 *   {
 *     code: string,
 *     gameTitle: string,
 *     gameCity: string,
 *     activationUrl: string,          // includes ?lang=<language> if language was passed
 *     audio?: {
 *       prepared: boolean,
 *       generated: number,
 *       skipped: number,
 *       failed: number,
 *       durationMs: number,
 *     }
 *   }
 */
export async function POST(request: NextRequest) {
  try {
    if (!validateApiKey(request)) {
      return NextResponse.json(
        { error: "Clé API invalide ou manquante" },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const { gameId, buyerEmail, buyerName, orderId } = body;
    const rawLanguage =
      typeof body.language === "string" ? body.language.toLowerCase().trim() : null;
    // Defensive: only accept a clean 2-letter ISO code
    const language = rawLanguage && /^[a-z]{2}$/.test(rawLanguage) ? rawLanguage : null;

    if (!gameId) {
      return NextResponse.json(
        { error: "Le champ gameId est requis" },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!buyerEmail) {
      return NextResponse.json(
        { error: "Le champ buyerEmail est requis" },
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = createAdminClient();

    // Verify the game exists
    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("id, title, city")
      .eq("id", gameId)
      .single();

    if (gameError || !game) {
      return NextResponse.json(
        { error: "Jeu introuvable avec cet identifiant" },
        { status: 404, headers: corsHeaders }
      );
    }

    // Generate the activation code using the city prefix
    const code = generateActivationCode(game.city);

    // Insert the code into activation_codes (with buyer_email for traceability)
    const { error: insertError } = await supabase
      .from("activation_codes")
      .insert({
        code,
        game_id: gameId,
        is_single_use: true,
        max_uses: 1,
        current_uses: 0,
        team_name: buyerName || null,
        buyer_email: buyerEmail,
        // expires_at stays null — set to now+8h upon activation
      });

    let finalCode = code;

    if (insertError) {
      // Code collision (extremely unlikely) — retry once
      const retryCode = generateActivationCode(game.city);
      const { error: retryError } = await supabase
        .from("activation_codes")
        .insert({
          code: retryCode,
          game_id: gameId,
          is_single_use: true,
          max_uses: 1,
          current_uses: 0,
          team_name: buyerName || null,
          buyer_email: buyerEmail,
        });

      if (retryError) {
        console.error("Erreur insertion code:", retryError);
        await sendCodeGenerationFailureAlert({
          gameId,
          gameCity: game.city,
          buyerEmail,
          error: retryError.message,
          orderId,
        });
        return NextResponse.json(
          { error: "Impossible de créer le code d'activation" },
          { status: 500, headers: corsHeaders }
        );
      }
      finalCode = retryCode;
    }

    // Log buyer info for traceability
    console.log(
      `[external/generate-code] code=${finalCode} game=${game.city} email=${buyerEmail} order=${orderId || "N/A"} lang=${language || "—"}`
    );

    // ─── Pre-generation: text translation + ElevenLabs audio ─────────
    // Synchronous: caller (Stripe webhook) must await so they email the
    // customer only after everything is ready. ~30-60s on first sale of
    // (game × language); near-instant on subsequent sales (cache hit).
    let audioReport: PackageStatsForResponse | undefined;
    if (language) {
      try {
        const result = await prepareGamePackage(gameId, language);
        audioReport = {
          prepared: result.success,
          generated: result.audioGenerated,
          skipped: result.audioSkipped,
          failed: result.audioFailed,
          durationMs: result.durationMs,
        };
        if (result.errors.length > 0) {
          console.error(
            `[external/generate-code] package errors for ${gameId}/${language}:`,
            result.errors,
          );
        }
      } catch (err) {
        // Audio prep failure must NOT block code delivery — the player
        // can still play with Web Speech fallback. Log + continue.
        console.error(
          `[external/generate-code] package prep crashed for ${gameId}/${language}:`,
          err,
        );
        audioReport = {
          prepared: false,
          generated: 0,
          skipped: 0,
          failed: 0,
          durationMs: 0,
        };
      }
    }

    // Activation URL pre-fills the language so the player lands directly
    // in the right locale (no language picker step on first visit).
    const activationBase = "https://escape-game-indol.vercel.app";
    const activationUrl = language
      ? `${activationBase}?code=${finalCode}&lang=${language}`
      : `${activationBase}?code=${finalCode}`;

    return NextResponse.json(
      {
        code: finalCode,
        gameTitle: extractTitle(game.title),
        gameCity: game.city,
        activationUrl,
        ...(audioReport && { audio: audioReport }),
      },
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error("[external/generate-code] Erreur:", err);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500, headers: corsHeaders }
    );
  }
}

interface PackageStatsForResponse {
  prepared: boolean;
  generated: number;
  skipped: number;
  failed: number;
  durationMs: number;
}
