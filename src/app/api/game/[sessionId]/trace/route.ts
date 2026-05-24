/**
 * POST /api/game/[sessionId]/trace
 *
 * Ingestion batch des positions GPS du joueur pendant sa partie.
 * Appelé toutes les ~60 sec par le frontend avec un buffer de ~2-4 samples
 * (capturés toutes les 30 sec).
 *
 * Body :
 *   {
 *     samples: [
 *       {
 *         lat: number,
 *         lon: number,
 *         accuracy?: number,    // précision GPS m
 *         heading?: number,     // cap 0-360°
 *         speed?: number,       // vitesse m/s
 *         step?: number,        // step_order actif au moment de la capture
 *         t: number             // Date.now() côté client (epoch ms)
 *       },
 *       ...
 *     ]
 *   }
 *
 * Auth : aucune (l'endpoint est appelé par le player UI sans login).
 * Sécurité : on valide que sessionId existe ET status='active'. Sinon 404.
 * Anti-flood : si > 50 samples dans un batch, on rejette (cap).
 *
 * Conformité RGPD : aucune donnée personnelle stockée — uniquement
 * lat/lon liés à un session_id pseudonymisé. Auto-purge 30 jours.
 *
 * Réponse : { inserted: <int>, skipped: <int> }
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface SampleInput {
  lat?: unknown;
  lon?: unknown;
  accuracy?: unknown;
  heading?: unknown;
  speed?: unknown;
  step?: unknown;
  t?: unknown;
}

const MAX_BATCH_SIZE = 50;

function num(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;

    const body = (await request.json()) as { samples?: SampleInput[] };
    if (!body?.samples || !Array.isArray(body.samples)) {
      return NextResponse.json(
        { error: "Body must contain 'samples' array" },
        { status: 400 },
      );
    }

    if (body.samples.length === 0) {
      return NextResponse.json({ inserted: 0, skipped: 0 });
    }
    if (body.samples.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `Batch too large (max ${MAX_BATCH_SIZE})` },
        { status: 413 },
      );
    }

    const supabase = createAdminClient();

    // Validate session exists + is active (refuse traces from completed/abandoned sessions)
    const { data: session, error: sessErr } = await supabase
      .from("game_sessions")
      .select("id, status")
      .eq("id", sessionId)
      .single();

    if (sessErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.status !== "active" && session.status !== "pending") {
      // Session terminée — on refuse silencieusement les samples tardifs
      return NextResponse.json({ inserted: 0, skipped: body.samples.length });
    }

    // Build rows
    const rows: Array<{
      session_id: string;
      latitude: number;
      longitude: number;
      accuracy_m: number | null;
      heading_deg: number | null;
      speed_mps: number | null;
      step_order: number | null;
      captured_at: string;
    }> = [];
    let skipped = 0;
    for (const s of body.samples) {
      const lat = num(s.lat);
      const lon = num(s.lon);
      if (lat === null || lon === null) {
        skipped++;
        continue;
      }
      const t = num(s.t);
      const captured_at = t
        ? new Date(t).toISOString()
        : new Date().toISOString();
      rows.push({
        session_id: sessionId,
        latitude: lat,
        longitude: lon,
        accuracy_m: num(s.accuracy),
        heading_deg: num(s.heading),
        speed_mps: num(s.speed),
        step_order: num(s.step),
        captured_at,
      });
    }

    if (rows.length === 0) {
      return NextResponse.json({ inserted: 0, skipped });
    }

    const { error: insErr } = await supabase.from("gps_traces").insert(rows);
    if (insErr) {
      console.error(
        `[gps_trace/${sessionId}] insert failed: ${insErr.message}`,
      );
      return NextResponse.json(
        { error: "Insert failed", details: insErr.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ inserted: rows.length, skipped });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `trace ingestion failed: ${msg}` },
      { status: 500 },
    );
  }
}
