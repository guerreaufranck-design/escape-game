/**
 * GET /api/admin/sessions/[id]/trace
 *
 * Retourne le tracé GPS complet d'une session pour visualisation admin
 * (page détail session avec carte Leaflet).
 *
 * Réponse :
 *   {
 *     session: { id, player_name, team_name, status, current_step, started_at,
 *                game_title, game_slug, game_mode },
 *     stops: [{ step, name, lat, lon, radius }, ...],
 *     trace: [{ lat, lon, accuracy, heading, speed, step, t }, ...],
 *     completions: [{ step, completed_at, hints_used }, ...]
 *   }
 *
 * Auth : admin session OU EXTERNAL_API_SECRET Bearer.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { validateApiKey } from "@/lib/external-auth";

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (validateApiKey(request)) return true;
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const admin = createAdminClient();
    const { data: adminRow } = await admin
      .from("admin_users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    return Boolean(adminRow);
  } catch {
    return false;
  }
}

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: session, error: sErr } = await supabase
    .from("game_sessions")
    .select(
      "id, player_name, team_name, game_id, status, current_step, total_steps, started_at, completed_at, total_time_seconds, games(title, slug, mode, start_point_lat, start_point_lon)",
    )
    .eq("id", id)
    .single();

  if (sErr || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const game = (session.games as unknown as {
    title: string;
    slug: string;
    mode: string;
    start_point_lat: number | null;
    start_point_lon: number | null;
  }) ?? null;

  const { data: steps } = await supabase
    .from("game_steps")
    .select("step_order, landmark_name, latitude, longitude, validation_radius_meters")
    .eq("game_id", session.game_id)
    .order("step_order");

  const { data: trace } = await supabase
    .from("gps_traces")
    .select("latitude, longitude, accuracy_m, heading_deg, speed_mps, step_order, captured_at")
    .eq("session_id", id)
    .order("captured_at");

  const { data: completions } = await supabase
    .from("step_completions")
    .select("step_order, completed_at, hints_used")
    .eq("session_id", id)
    .order("completed_at");

  return NextResponse.json({
    session: {
      id: session.id,
      player_name: session.player_name,
      team_name: session.team_name,
      status: session.status,
      current_step: session.current_step,
      total_steps: session.total_steps,
      started_at: session.started_at,
      completed_at: session.completed_at,
      total_time_seconds: session.total_time_seconds,
      game_title: game?.title ?? "Unknown",
      game_slug: game?.slug ?? null,
      game_mode: game?.mode ?? "city_game",
      game_start_lat: game?.start_point_lat ?? null,
      game_start_lon: game?.start_point_lon ?? null,
    },
    stops:
      steps?.map((s) => ({
        step: s.step_order,
        name: s.landmark_name ?? `Step ${s.step_order}`,
        lat: s.latitude,
        lon: s.longitude,
        radius: s.validation_radius_meters,
      })) ?? [],
    trace:
      trace?.map((t) => ({
        lat: t.latitude,
        lon: t.longitude,
        accuracy: t.accuracy_m,
        heading: t.heading_deg,
        speed: t.speed_mps,
        step: t.step_order,
        t: t.captured_at,
      })) ?? [],
    completions:
      completions?.map((c) => ({
        step: c.step_order,
        completed_at: c.completed_at,
        hints_used: c.hints_used,
      })) ?? [],
  });
}
