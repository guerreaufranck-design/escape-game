import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t, detectLocale } from "@/lib/i18n";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const locale = detectLocale(request);
    const body = await request.json();
    const { code } = body;
    const supabase = createAdminClient();

    // Fetch session
    const { data: session } = await supabase
      .from("game_sessions")
      .select("game_id, total_steps")
      .eq("id", sessionId)
      .single();

    if (!session) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }

    // Fetch all steps' answers in order
    const { data: steps } = await supabase
      .from("game_steps")
      .select("step_order, answer_text")
      .eq("game_id", session.game_id)
      .order("step_order", { ascending: true });

    if (!steps) {
      return NextResponse.json({ error: "Etapes introuvables" }, { status: 404 });
    }

    // Build the expected code: concatenation of all answers separated by dashes
    const expectedParts = steps.map((s) => t(s.answer_text, locale) || "");
    const expectedCode = expectedParts.join("-");

    // Also accept without separators
    const expectedCodeNoSep = expectedParts.join("");

    // Normalize for comparison (lowercase, trim, remove extra spaces)
    const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, "");

    const userCode = normalize(code);
    const isValid =
      userCode === normalize(expectedCode) ||
      userCode === normalize(expectedCodeNoSep) ||
      // Also check if the individual parts all match
      (() => {
        // Split user input by common separators
        const userParts = code.split(/[-_\s.,;/|]+/).map((p: string) => normalize(p));
        if (userParts.length !== expectedParts.length) return false;
        return userParts.every((p: string, i: number) => p === normalize(expectedParts[i]));
      })();

    return NextResponse.json({
      valid: isValid,
      expectedCode: isValid ? expectedCode : null,
      message: isValid
        ? "Felicitations ! Le code est correct !"
        : "Code incorrect. Verifiez vos reponses.",
    });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
