/**
 * GET /api/cron/purge-gps-traces
 *
 * Cron quotidien (3h UTC) qui purge les traces GPS de plus de 30 jours.
 *
 * Conformité RGPD : retention limitée annoncée au joueur dans le briefing.
 * Le scope est large (DELETE WHERE received_at < NOW() - 30 jours), pas
 * de critère par joueur — les traces étant déjà pseudonymisées (session_id
 * sans email/nom), la purge globale suffit.
 *
 * Auth : aucune (route cron Vercel-only, protégée par convention via
 * vercel.json + filtering au niveau Edge si nécessaire).
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createAdminClient();
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [gpsRes, arRes] = await Promise.all([
      supabase
        .from("gps_traces")
        .delete({ count: "exact" })
        .lt("received_at", cutoff),
      supabase
        .from("ar_events")
        .delete({ count: "exact" })
        .lt("received_at", cutoff),
    ]);

    if (gpsRes.error || arRes.error) {
      console.error(
        `[cron/purge-gps-traces] failed: gps=${gpsRes.error?.message ?? "ok"}, ar=${arRes.error?.message ?? "ok"}`,
      );
      return NextResponse.json(
        { ok: false, gps_error: gpsRes.error?.message, ar_error: arRes.error?.message },
        { status: 500 },
      );
    }

    console.log(
      `[cron/purge-gps-traces] purged ${gpsRes.count ?? 0} gps + ${arRes.count ?? 0} ar events older than ${cutoff}`,
    );
    return NextResponse.json({
      ok: true,
      gps_purged: gpsRes.count ?? 0,
      ar_events_purged: arRes.count ?? 0,
      cutoff,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`[cron/purge-gps-traces] exception: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
