import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { activateSchema } from "@/lib/validators";
import { t, detectLocale } from "@/lib/i18n";
import { verifyCodeSignature } from "@/lib/code-generator";

const MAX_SESSION_HOURS = 8;

export async function POST(request: NextRequest) {
  try {
    const locale = detectLocale(request);
    const body = await request.json();
    const parsed = activateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { code, playerName, teamName } = parsed.data;
    const supabase = createAdminClient();

    // Optional: verify HMAC signature for signed codes (non-legacy)
    // Legacy codes (manual/test) still work via DB lookup
    const codeUpper = code.toUpperCase().trim();

    // Check if code exists and is not expired
    const { data: codeRow } = await supabase
      .from("activation_codes")
      .select("id, expires_at, is_single_use, current_uses, max_uses")
      .eq("code", codeUpper)
      .single();

    if (codeRow?.expires_at) {
      const expiresAt = new Date(codeRow.expires_at);
      if (expiresAt < new Date()) {
        return NextResponse.json(
          { error: "Code expire. La validite est de 8 heures apres activation." },
          { status: 400 }
        );
      }
    }

    // Call the RPC to activate
    const { data, error } = await supabase.rpc("activate_code", {
      p_code: codeUpper,
      p_player_name: playerName,
      p_team_name: teamName,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    const result = data as unknown as Record<string, unknown>;

    if (result?.error) {
      return NextResponse.json(
        { error: result.error as string },
        { status: 400 }
      );
    }

    const sessionId = result?.sessionId || result?.session_id;
    const gameTitle = result?.gameTitle || result?.game_title;
    const totalSteps = result?.totalSteps || result?.total_steps;

    if (!sessionId) {
      return NextResponse.json(
        { error: "Code invalide ou expire" },
        { status: 400 }
      );
    }

    // Set expires_at to now + 8h on first activation of single-use codes
    if (codeRow && codeRow.is_single_use && !codeRow.expires_at) {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + MAX_SESSION_HOURS);
      await supabase
        .from("activation_codes")
        .update({ expires_at: expiresAt.toISOString() })
        .eq("id", codeRow.id);
    }

    return NextResponse.json({
      sessionId,
      gameTitle: t(gameTitle, locale),
      totalSteps,
    });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
