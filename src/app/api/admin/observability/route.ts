/**
 * Admin endpoint : GET /api/admin/observability
 *
 * Returns the pipeline SLO snapshot used by the observability dashboard
 * (Sprint 4.3, 2026-05-21). Aggregates the last 7 days of
 * `pipeline_telemetry` data and computes :
 *
 *   * Success rate per phase (quality_passes ratio)
 *   * Median + p99 quality score per phase
 *   * Median + p99 duration per phase
 *   * Current thresholds from pipeline_thresholds
 *   * SLO indicator (overall success rate vs target 95%)
 *
 * Auth : admin session required.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface Row {
  phase: string;
  duration_ms: number | null;
  quality_score: number | null;
  quality_passes: boolean | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx];
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

export async function GET() {
  // Admin auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Window : last 7 days
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Pull telemetry
  const { data: rowsRaw, error: telemetryErr } = await admin
    .from("pipeline_telemetry")
    .select("phase, duration_ms, quality_score, quality_passes, metadata, created_at")
    .gte("created_at", since)
    .not("quality_score", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (telemetryErr) {
    return NextResponse.json(
      { error: telemetryErr.message },
      { status: 500 },
    );
  }
  const rows = (rowsRaw ?? []) as Row[];

  // Group by phase_id (fine-grained)
  const byPhase: Record<string, Row[]> = {};
  for (const r of rows) {
    const phaseId =
      (r.metadata?.phase_id as string | undefined) ?? r.phase ?? "other";
    byPhase[phaseId] = byPhase[phaseId] ?? [];
    byPhase[phaseId].push(r);
  }

  // Per-phase metrics
  const phases = Object.entries(byPhase).map(([phaseId, rs]) => {
    const passing = rs.filter((r) => r.quality_passes === true).length;
    const total = rs.length;
    const qualities = rs.map((r) => r.quality_score!).filter(Number.isFinite);
    const durations = rs
      .map((r) => r.duration_ms ?? 0)
      .filter((v) => v > 0);
    return {
      phase: phaseId,
      sample_size: total,
      success_rate: total > 0 ? passing / total : 0,
      quality_p50: Number(median(qualities).toFixed(2)),
      quality_p99: Number(percentile(qualities, 0.99).toFixed(2)),
      duration_p50_ms: Math.round(median(durations)),
      duration_p99_ms: Math.round(percentile(durations, 0.99)),
    };
  });
  phases.sort((a, b) => a.phase.localeCompare(b.phase));

  // Overall SLO : success rate across critical phases (1b + 2a + 2c)
  const criticalPhases = phases.filter((p) =>
    ["phase1b", "phase2a", "phase2c"].includes(p.phase),
  );
  const criticalTotal = criticalPhases.reduce((s, p) => s + p.sample_size, 0);
  const criticalPassing = criticalPhases.reduce(
    (s, p) => s + Math.round(p.success_rate * p.sample_size),
    0,
  );
  const slo_success_rate =
    criticalTotal > 0 ? criticalPassing / criticalTotal : 1;
  const SLO_TARGET = 0.95;
  const slo_status = slo_success_rate >= SLO_TARGET ? "healthy" : "degraded";

  // Current thresholds
  const { data: thresholds } = await admin
    .from("pipeline_thresholds")
    .select("dimension, value, sample_size, last_computed_at")
    .order("dimension");

  // Recent failures (for the alert section)
  const recentFailures = rows
    .filter((r) => r.quality_passes === false)
    .slice(0, 20)
    .map((r) => ({
      phase: (r.metadata?.phase_id as string | undefined) ?? r.phase,
      created_at: r.created_at,
      quality_score: r.quality_score,
      metadata: r.metadata,
    }));

  return NextResponse.json({
    window: { since, until: new Date().toISOString(), days: 7 },
    slo: {
      target: SLO_TARGET,
      observed: Number(slo_success_rate.toFixed(3)),
      status: slo_status,
      sample_size: criticalTotal,
    },
    phases,
    thresholds: thresholds ?? [],
    recent_failures: recentFailures,
  });
}
