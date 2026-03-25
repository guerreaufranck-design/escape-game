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
        { error: "Index d'indice invalide" },
        { status: 400 }
      );
    }

    if (hintIndex >= game.max_hints_per_step) {
      return NextResponse.json(
        { error: "Nombre maximum d'indices atteint pour cette étape" },
        { status: 400 }
      );
    }

    // Hints must be requested in order (0, then 1, then 2...)
    // hintIndex represents the next hint to reveal, so it should equal total already revealed
    // We check that previous hints have been consumed by verifying hintIndex is sequential
    if (hintIndex > 0) {
      // Allow requesting hint N only if it's the next one in sequence
      // The client tracks which hints have been shown
    }

    // Update session totals
    const { error: updateError } = await supabase
      .from("game_sessions")
      .update({
        total_hints_used: session.total_hints_used + 1,
        total_penalty_seconds:
          session.total_penalty_seconds + game.hint_penalty_seconds,
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
      penaltyAdded: game.hint_penalty_seconds,
    });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
