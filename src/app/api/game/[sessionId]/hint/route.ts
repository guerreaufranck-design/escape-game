import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hintSchema } from "@/lib/validators";
import { t, detectLocale, isStaticLocale } from "@/lib/i18n";
import { translateGameField } from "@/lib/translate-service";
import type { Hint } from "@/types/game";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const locale = detectLocale(request);
    const body = await request.json();
    const parsed = hintSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { stepOrder, hintIndex } = parsed.data;
    const supabase = createAdminClient();

    // Fetch session
    const { data: session, error: sessionError } = await supabase
      .from("game_sessions")
      .select("*, games(max_hints_per_step, hint_penalty_seconds)")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Session introuvable" },
        { status: 404 }
      );
    }

    if (session.status !== "active") {
      return NextResponse.json(
        { error: "La session n'est pas active" },
        { status: 400 }
      );
    }

    if (stepOrder !== session.current_step) {
      return NextResponse.json(
        { error: "Ce n'est pas l'étape en cours" },
        { status: 400 }
      );
    }

    const game = session.games as unknown as {
      max_hints_per_step: number;
      hint_penalty_seconds: number;
    };

    // Fetch current step
    const { data: step, error: stepError } = await supabase
      .from("game_steps")
      .select("hints")
      .eq("game_id", session.game_id)
      .eq("step_order", stepOrder)
      .single();

    if (stepError || !step) {
      return NextResponse.json(
        { error: "Étape introuvable" },
        { status: 404 }
      );
    }

    const hints = (step.hints as unknown as Hint[]) || [];

    // Validate hint index
    if (hintIndex < 0 || hintIndex >= hints.length) {
      return NextResponse.json(
        { error: "Plus d'indices disponibles pour cette étape" },
        { status: 400 }
      );
    }

    // Progressive penalty: a hint within the per-game cheap allowance
    // (`max_hints_per_step`) costs the game's base penalty; anything
    // beyond is a small extra cost so the leaderboard stays meaningful
    // without making players feel punished for asking. Soft enough that
    // the player's emotional cost of asking is the real limit.
    const EXTRA_HINT_PENALTY = 60; // 1 minute in seconds
    const penaltySeconds = hintIndex < game.max_hints_per_step
      ? game.hint_penalty_seconds
      : EXTRA_HINT_PENALTY;

    // Update session totals
    const { error: updateError } = await supabase
      .from("game_sessions")
      .update({
        total_hints_used: session.total_hints_used + 1,
        total_penalty_seconds:
          session.total_penalty_seconds + penaltySeconds,
      })
      .eq("id", sessionId);

    if (updateError) {
      return NextResponse.json(
        { error: "Erreur lors de la mise à jour" },
        { status: 500 }
      );
    }

    const hint = hints[hintIndex];
    let hintText = t(hint.text, locale);

    // Translate hint text when needed:
    // - non-static locales (Chinese, etc.) always need Gemini
    // - static locales != 'en' also need Gemini when hint is plain English (pipeline-generated)
    const hintIsPlainEnglish = typeof hint.text === "string" && !String(hint.text).startsWith("{");
    const hintNeedsGemini = !isStaticLocale(locale) || (locale !== "en" && hintIsPlainEnglish);

    if (hintNeedsGemini) {
      const enText = typeof hint.text === "object"
        ? (hint.text as Record<string, string>).en || (hint.text as Record<string, string>).fr || Object.values(hint.text as Record<string, string>)[0] || ""
        : String(hint.text);
      if (enText) {
        try {
          hintText = await translateGameField(
            `hint-${session.game_id}-${stepOrder}-${hintIndex}`,
            "game_steps", "hint_text", enText, locale
          );
        } catch {
          // Keep fallback
        }
      }
    }

    return NextResponse.json({
      hint: {
        order: hint.order,
        text: hintText,
        image: hint.image || null,
      },
      totalHintsUsed: session.total_hints_used + 1,
      penaltyAdded: penaltySeconds,
      isExtraHint: hintIndex >= game.max_hints_per_step,
    });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
