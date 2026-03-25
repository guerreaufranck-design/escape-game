import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hintSchema } from "@/lib/validators";
import { t, detectLocale } from "@/lib/i18n";
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

    // Progressive penalty: first 3 hints = base penalty (2min), extras = 10min each
    const EXTRA_HINT_PENALTY = 600; // 10 minutes in seconds
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

    return NextResponse.json({
      hint: {
        order: hint.order,
        text: t(hint.text, locale),
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
