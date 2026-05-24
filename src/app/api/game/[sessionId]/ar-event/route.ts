/**
 * POST /api/game/[sessionId]/ar-event
 *
 * Ingestion batch des événements AR du joueur pendant sa partie.
 *
 * Body :
 *   {
 *     events: [
 *       {
 *         type: "ar_open" | "ar_camera_ready" | "ar_camera_denied" |
 *               "ar_compass_granted" | "ar_compass_denied" |
 *               "ar_lock_on" | "ar_facade_revealed" | "ar_character_speak" |
 *               "ar_auto_validated" | "ar_manual_validated" | "ar_close",
 *         step?: number,           // step_order actif
 *         meta?: object,           // distance, angle, reason, etc.
 *         t: number                // Date.now()
 *       },
 *       ...
 *     ]
 *   }
 *
 * Auth : aucune (player UI sans login).
 * Validation : sessionId existe + status active|pending.
 * Cap batch : 30 events max (les events sont rares vs GPS samples).
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_BATCH = 30;

const ALLOWED_TYPES = new Set([
  "ar_open",
  "ar_camera_ready",
  "ar_camera_denied",
  "ar_compass_granted",
  "ar_compass_denied",
  "ar_lock_on",
  "ar_facade_revealed",
  "ar_character_speak",
  "ar_auto_validated",
  "ar_manual_validated",
  "ar_close",
]);

interface EventInput {
  type?: unknown;
  step?: unknown;
  meta?: unknown;
  t?: unknown;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const body = (await request.json()) as { events?: EventInput[] };
    if (!body?.events || !Array.isArray(body.events)) {
      return NextResponse.json(
        { error: "Body must contain 'events' array" },
        { status: 400 },
      );
    }
    if (body.events.length === 0) {
      return NextResponse.json({ inserted: 0, skipped: 0 });
    }
    if (body.events.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `Batch too large (max ${MAX_BATCH})` },
        { status: 413 },
      );
    }

    const supabase = createAdminClient();

    const { data: session, error: sErr } = await supabase
      .from("game_sessions")
      .select("id, status")
      .eq("id", sessionId)
      .single();
    if (sErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.status !== "active" && session.status !== "pending") {
      return NextResponse.json({ inserted: 0, skipped: body.events.length });
    }

    const rows: Array<{
      session_id: string;
      step_order: number | null;
      event_type: string;
      metadata: object | null;
      captured_at: string;
    }> = [];
    let skipped = 0;
    for (const e of body.events) {
      const type = typeof e.type === "string" ? e.type : null;
      if (!type || !ALLOWED_TYPES.has(type)) {
        skipped++;
        continue;
      }
      const step =
        typeof e.step === "number" && Number.isFinite(e.step) ? e.step : null;
      const t = typeof e.t === "number" ? new Date(e.t).toISOString() : new Date().toISOString();
      rows.push({
        session_id: sessionId,
        step_order: step,
        event_type: type,
        metadata: (typeof e.meta === "object" && e.meta !== null) ? e.meta : null,
        captured_at: t,
      });
    }
    if (rows.length === 0) {
      return NextResponse.json({ inserted: 0, skipped });
    }

    const { error: insErr } = await supabase.from("ar_events").insert(rows);
    if (insErr) {
      console.error(`[ar_event/${sessionId}] insert failed: ${insErr.message}`);
      return NextResponse.json(
        { error: "Insert failed", details: insErr.message },
        { status: 500 },
      );
    }
    return NextResponse.json({ inserted: rows.length, skipped });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: `ar-event ingestion failed: ${msg}` },
      { status: 500 },
    );
  }
}
