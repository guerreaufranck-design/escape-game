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

    const { error, count } = await supabase
      .from("gps_traces")
      .delete({ count: "exact" })
      .lt("received_at", cutoff);

    if (error) {
      console.error(`[cron/purge-gps-traces] failed: ${error.message}`);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    console.log(`[cron/purge-gps-traces] purged ${count ?? 0} traces older than ${cutoff}`);
    return NextResponse.json({ ok: true, purged: count ?? 0, cutoff });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`[cron/purge-gps-traces] exception: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
