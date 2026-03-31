import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateApiKey, corsHeaders } from "@/lib/external-auth";

/**
 * OPTIONS /api/external/validate-code
 * Handle CORS preflight requests.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/external/validate-code?code=XXXX-XXXX-XXXX
 * Check if an activation code is valid (for oddballtrip to show status).
 *
 * Headers:
 *   Authorization: Bearer {EXTERNAL_API_SECRET}
 *
 * Returns:
 *   { valid: boolean, code: string, gameTitle?: string, gameCity?: string,
 *     isUsed?: boolean, currentUses?: number, maxUses?: number }
 */
export async function GET(request: NextRequest) {
  try {
    if (!validateApiKey(request)) {
      return NextResponse.json(
        { error: "Clé API invalide ou manquante" },
        { status: 401, headers: corsHeaders }
      );
    }

    const code = request.nextUrl.searchParams.get("code");

    if (!code) {
      return NextResponse.json(
        { error: "Le paramètre code est requis" },
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = createAdminClient();

    // Look up code and join with games
    const { data: codeRow, error: codeError } = await supabase
      .from("activation_codes")
      .select("code, game_id, is_single_use, max_uses, current_uses, games(title, city)")
      .eq("code", code.toUpperCase().trim())
      .single();

    if (codeError || !codeRow) {
      return NextResponse.json(
        {
          valid: false,
          code: code.toUpperCase().trim(),
        },
        { headers: corsHeaders }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const game = (codeRow as any).games;
    const isUsed = codeRow.current_uses >= codeRow.max_uses;

    return NextResponse.json(
      {
        valid: true,
        code: codeRow.code,
        gameTitle: game?.title || null,
        gameCity: game?.city || null,
        isUsed,
        currentUses: codeRow.current_uses,
        maxUses: codeRow.max_uses,
      },
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error("[external/validate-code] Erreur:", err);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500, headers: corsHeaders }
    );
  }
}
