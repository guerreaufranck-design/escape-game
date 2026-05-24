/**
 * GET /api/admin/sessions/live
 *
 * Liste toutes les sessions actives ou récemment actives (dernier ping
 * GPS < 30 min) pour le dashboard admin live.
 *
 * Pour chaque session :
 *   - Méta : player_name, team_name, game_title, current_step, total_steps
 *   - Dernière position GPS connue (lat, lon, captured_at)
 *   - Temps depuis le dernier ping (signal "joueur encore connecté ?")
 *   - Stops du jeu pour affichage carte
 *
 * Auth : admin session OU EXTERNAL_API_SECRET Bearer.
 *
 * Réponse :
 *   {
 *     active_sessions: [
 *       {
 *         session_id, player_name, team_name, game_title, game_slug,
 *         current_step, total_steps, status, started_at,
 *         last_position: { lat, lon, accuracy, captured_at } | null,
 *         seconds_since_last_ping: number | null,
 *         next_stop: { step, name, lat, lon, radius } | null
 *       },
 *       ...
 *     ]
 *   }
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

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Active sessions (status = 'active', started in last 24h to filter abandoned)
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: sessions, error: sessErr } = await supabase
    .from("game_sessions")
    .select(
      "id, player_name, team_name, game_id, status, current_step, total_steps, started_at, games(title, slug, mode)",
    )
    .eq("status", "active")
    .gte("started_at", cutoff24h)
    .order("started_at", { ascending: false })
    .limit(50);

  if (sessErr) {
    return NextResponse.json(
      { error: "Sessions fetch failed", details: sessErr.message },
      { status: 500 },
    );
  }

  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ active_sessions: [] });
  }

  // Last position per session (1 query, group by session_id)
  const sessionIds = sessions.map((s) => s.id);
  const { data: lastTraces } = await supabase
    .from("gps_traces")
    .select("session_id, latitude, longitude, accuracy_m, captured_at, step_order")
    .in("session_id", sessionIds)
    .order("captured_at", { ascending: false });

  // Reduce to last position per session
  const lastBySession = new Map<
    string,
    {
      lat: number;
      lon: number;
      accuracy: number | null;
      captured_at: string;
      step: number | null;
    }
  >();
  for (const t of lastTraces ?? []) {
    if (!lastBySession.has(t.session_id)) {
      lastBySession.set(t.session_id, {
        lat: t.latitude,
        lon: t.longitude,
        accuracy: t.accuracy_m,
        captured_at: t.captured_at,
        step: t.step_order,
      });
    }
  }

  // Stops for each game (for "next stop" pointer)
  const gameIds = [...new Set(sessions.map((s) => s.game_id))];
  const { data: allSteps } = await supabase
    .from("game_steps")
    .select("game_id, step_order, landmark_name, latitude, longitude, validation_radius_meters")
    .in("game_id", gameIds);

  const stepsByGame = new Map<
    string,
    Array<{
      step: number;
      name: string;
      lat: number;
      lon: number;
      radius: number;
    }>
  >();
  for (const s of allSteps ?? []) {
    if (!stepsByGame.has(s.game_id)) stepsByGame.set(s.game_id, []);
    stepsByGame.get(s.game_id)!.push({
      step: s.step_order,
      name: s.landmark_name ?? `Step ${s.step_order}`,
      lat: s.latitude,
      lon: s.longitude,
      radius: s.validation_radius_meters,
    });
  }
  for (const list of stepsByGame.values()) {
    list.sort((a, b) => a.step - b.step);
  }

  const now = Date.now();
  const enriched = sessions.map((s) => {
    const lastPos = lastBySession.get(s.id) ?? null;
    const secondsSince = lastPos
      ? Math.round((now - new Date(lastPos.captured_at).getTime()) / 1000)
      : null;
    const stops = stepsByGame.get(s.game_id) ?? [];
    const nextStop = stops.find((st) => st.step === s.current_step) ?? null;
    return {
      session_id: s.id,
      player_name: s.player_name,
      team_name: s.team_name,
      game_title:
        (s.games as unknown as { title: string })?.title ?? "Unknown",
      game_slug:
        (s.games as unknown as { slug: string })?.slug ?? null,
      game_mode:
        (s.games as unknown as { mode: string })?.mode ?? "city_game",
      current_step: s.current_step,
      total_steps: s.total_steps,
      status: s.status,
      started_at: s.started_at,
      last_position: lastPos,
      seconds_since_last_ping: secondsSince,
      next_stop: nextStop,
    };
  });

  return NextResponse.json({ active_sessions: enriched });
}
