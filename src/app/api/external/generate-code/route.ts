import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  validateApiKey,
  generateActivationCode,
  corsHeaders,
} from "@/lib/external-auth";

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
 *   { gameId: string, buyerEmail: string, buyerName?: string, orderId?: string }
 *
 * Returns:
 *   { code: string, gameTitle: string, gameCity: string, activationUrl: string }
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

    // Insert the code into activation_codes
    const { error: insertError } = await supabase
      .from("activation_codes")
      .insert({
        code,
        game_id: gameId,
        is_single_use: true,
        max_uses: 1,
        current_uses: 0,
        team_name: buyerName || null,
        // expires_at stays null — set to now+8h upon activation
      });

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
        });

      if (retryError) {
        console.error("Erreur insertion code:", retryError);
        return NextResponse.json(
          { error: "Impossible de créer le code d'activation" },
          { status: 500, headers: corsHeaders }
        );
      }

      return NextResponse.json(
        {
          code: retryCode,
          gameTitle: extractTitle(game.title),
          gameCity: game.city,
          activationUrl: `https://escape-game-indol.vercel.app?code=${retryCode}`,
        },
        { headers: corsHeaders }
      );
    }

    // Log buyer info for traceability (optional metadata)
    if (buyerEmail || orderId) {
      console.log(
        `[external/generate-code] code=${code} game=${game.city} email=${buyerEmail} order=${orderId || "N/A"}`
      );
    }

    return NextResponse.json(
      {
        code,
        gameTitle: extractTitle(game.title),
        gameCity: game.city,
        activationUrl: `https://escape-game-indol.vercel.app?code=${code}`,
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
