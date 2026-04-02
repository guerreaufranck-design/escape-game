import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateWalkingDirections } from "@/lib/gemini";
import { detectLocale } from "@/lib/i18n";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const locale = detectLocale(request);

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ directions: null });
    }

    const supabase = createAdminClient();

    const { data: session } = await supabase
      .from("game_sessions")
      .select("game_id, current_step, status")
      .eq("id", sessionId)
      .single();

    if (!session || session.status !== "active" || session.current_step <= 1) {
      return NextResponse.json({ directions: null });
    }

    // Fetch current and previous step
    const { data: steps } = await supabase
      .from("game_steps")
      .select("step_order, latitude, longitude, title")
      .eq("game_id", session.game_id)
      .in("step_order", [session.current_step, session.current_step - 1])
      .order("step_order", { ascending: true });

    if (!steps || steps.length < 2) {
      return NextResponse.json({ directions: null });
    }

    const prevStep = steps.find((s) => s.step_order === session.current_step - 1);
    const currStep = steps.find((s) => s.step_order === session.current_step);

    if (!prevStep || !currStep) {
      return NextResponse.json({ directions: null });
    }

    const stepTitle = typeof currStep.title === "object"
      ? (currStep.title as Record<string, string>)[locale] || (currStep.title as Record<string, string>).fr || Object.values(currStep.title as Record<string, string>)[0]
      : String(currStep.title);

    const directions = await generateWalkingDirections(
      prevStep.latitude, prevStep.longitude,
      currStep.latitude, currStep.longitude,
      stepTitle, locale
    );

    return NextResponse.json({ directions });
  } catch (err) {
    console.error("Erreur generation directions:", err);
    return NextResponse.json({ directions: null });
  }
}
