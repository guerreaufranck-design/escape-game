import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { activateSchema } from "@/lib/validators";
import { t, detectLocale } from "@/lib/i18n";
import { sendPlayerStartAlert } from "@/lib/email";

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

    const codeUpper = code.toUpperCase().trim();

    // Call the RPC to activate (creates session with status='pending', no timer)
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

    // Suivi joueur (2026-07-09) — email dès l'activation. On enrichit avec la
    // ville + l'acheteur (lookup léger via le code). Best-effort, awaité pour
    // fiabilité (l'activation est un événement rare, ~400ms invisible).
    try {
      let gameCity = "";
      let buyerEmail: string | null = null;
      const { data: codeRow } = await supabase
        .from("activation_codes")
        .select("game_id, buyer_email")
        .eq("code", codeUpper)
        .single();
      if (codeRow?.game_id) {
        buyerEmail = codeRow.buyer_email ?? null;
        const { data: g } = await supabase
          .from("games")
          .select("city")
          .eq("id", codeRow.game_id)
          .single();
        gameCity = g?.city ?? "";
      }
      await sendPlayerStartAlert({
        gameCity: gameCity || (typeof gameTitle === "string" ? gameTitle : ""),
        gameTitle: t(gameTitle, locale),
        playerName,
        teamName,
        code: codeUpper,
        sessionId: String(sessionId),
        totalSteps: typeof totalSteps === "number" ? totalSteps : null,
        buyerEmail,
      });
    } catch {
      /* alerte non bloquante */
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
