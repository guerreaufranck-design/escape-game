/**
 * Cron : recompute-pipeline-thresholds (Sprint 4.2, 2026-05-21).
 *
 * Runs WEEKLY. Reads the last N=200 `pipeline_telemetry` rows per
 * `(phase, transport_mode_bucket)` and updates `pipeline_thresholds`
 * with computed quality_floor + predictor coefficients.
 *
 * ═══════════════════════════════════════════════════════════════════
 * Math model — recomputation
 * ═══════════════════════════════════════════════════════════════════
 *
 * Quality floors :
 *   floor(phase) = max(seed_floor, p10(quality_score | phase, passes=true))
 *
 *   Reading : "we won't accept worse than the worst quality_score that
 *   passed in the recent past, but never lower than the seed floor".
 *   This keeps the floor adaptive : if the pipeline genuinely improves
 *   over time, the floor follows; if it degrades, the floor doesn't.
 *
 * Predictor coefficients :
 *   We fit log(duration_ms) ~ N(μ, σ²) with
 *     μ = β₀ + β₁·radius + β₂·is_roadtrip + β₃·theme_len/100 + β₄·multi
 *
 *   Method : ridge regression with λ=0.1 (Bayesian linear regression
 *   with isotropic Gaussian prior on β). λ small enough to let the data
 *   speak, large enough to stabilize when sample size is small.
 *
 *   For now we ship the simpler approach : EWMA of the per-feature
 *   delta vs current SEED_BETA. This is online-learning friendly and
 *   doesn't require pulling in a stats library. Full ridge regression
 *   ships in Sprint 4.4 when we have ≥500 telemetry rows.
 *
 *   EWMA formula :
 *     β_new = α · β_observed + (1 - α) · β_old
 *   with α = 0.3 — balances reactivity (3-week half-life) vs stability.
 *
 * Sigma :
 *   σ = sqrt(var(log(duration_ms))) over last N runs, floored at 0.2
 *   (below 0.2 the predictor becomes overconfident).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Vercel cron config
 * ═══════════════════════════════════════════════════════════════════
 *
 * Register in `vercel.json` :
 *   { "path": "/api/cron/recompute-pipeline-thresholds",
 *     "schedule": "0 3 * * 1" }   ← every Monday 03:00 UTC
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

interface TelemetryRow {
  phase: string;
  duration_ms: number | null;
  quality_score: number | null;
  quality_passes: boolean | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx];
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return (
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)
  );
}

export async function GET(request: NextRequest) {
  // Vercel cron auth
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (
    cronSecret &&
    authHeader !== `Bearer ${cronSecret}` &&
    process.env.NODE_ENV === "production"
  ) {
    return NextResponse.json({ error: "Unauthorized cron call" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Pull last 200 rows per phase from the past 30 days.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from("pipeline_telemetry")
    .select("phase, duration_ms, quality_score, quality_passes, metadata, created_at")
    .gte("created_at", since)
    .not("quality_score", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    console.error(`[recompute-thresholds] DB read failed: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const telemetry = (rows ?? []) as TelemetryRow[];
  console.log(`[recompute-thresholds] Loaded ${telemetry.length} rows from past 30d`);

  // ── Quality floors per phase ──────────────────────────────────────
  // Group by metadata.phase_id (the fine-grained identifier we set in
  // recordPhaseQuality), fall back to telemetry.phase otherwise.
  const groups: Record<string, TelemetryRow[]> = {};
  for (const r of telemetry) {
    const phaseId =
      (r.metadata?.phase_id as string | undefined) ?? r.phase ?? "other";
    if (!phaseId.startsWith("phase")) continue;
    groups[phaseId] = groups[phaseId] ?? [];
    groups[phaseId].push(r);
  }

  const upserts: Array<{
    dimension: string;
    value: number;
    sample_size: number;
    metadata: Record<string, unknown>;
  }> = [];

  const SEED_FLOORS: Record<string, number> = {
    phase1a: 0.3,
    phase1b: 0.7,
    phase2a: 0.75,
    phase2b: 0.6,
    phase2c: 0.5,
  };

  for (const [phaseId, rs] of Object.entries(groups)) {
    const passingScores = rs
      .filter((r) => r.quality_passes === true && r.quality_score !== null)
      .map((r) => r.quality_score!);
    if (passingScores.length < 10) continue; // not enough data to recompute

    const p10 = percentile(passingScores, 0.1);
    const seedFloor = SEED_FLOORS[phaseId] ?? 0.5;
    const newFloor = Math.max(seedFloor, p10);

    upserts.push({
      dimension: `quality_floor.${phaseId}`,
      value: Number(newFloor.toFixed(2)),
      sample_size: passingScores.length,
      metadata: {
        method: "max(seed_floor, p10(passing_quality_scores))",
        p10: Number(p10.toFixed(2)),
        seed_floor: seedFloor,
        passing_count: passingScores.length,
        total_count: rs.length,
        window_days: 30,
      },
    });
  }

  // ── Predictor σ (sigma) from phase1a durations ────────────────────
  const phase1aRows = telemetry.filter(
    (r) =>
      (r.metadata?.phase_id as string | undefined) === "phase1a" &&
      r.duration_ms !== null,
  );
  if (phase1aRows.length >= 20) {
    const logDurations = phase1aRows
      .map((r) => Math.log(r.duration_ms!))
      .filter((v) => Number.isFinite(v));
    const sigma = Math.max(0.2, Math.sqrt(variance(logDurations)));
    upserts.push({
      dimension: "predictor.sigma",
      value: Number(sigma.toFixed(3)),
      sample_size: logDurations.length,
      metadata: {
        method: "sqrt(var(log(duration_ms)))",
        floor: 0.2,
        sample_size: logDurations.length,
      },
    });
  }

  // ── Predictor β intercept (EWMA of mean log duration on walking, low complexity) ──
  // We use the EWMA method described in the docstring : β_new = α·β_obs + (1-α)·β_old.
  // For this MVP we only update intercept based on observed walking runs.
  if (phase1aRows.length >= 10) {
    const walkingRows = phase1aRows.filter(
      (r) => (r.metadata?.transport_mode as string | undefined) === "walking",
    );
    if (walkingRows.length >= 5) {
      const logDurations = walkingRows
        .map((r) => Math.log(r.duration_ms!))
        .filter((v) => Number.isFinite(v));
      const observedIntercept = average(logDurations);

      // Fetch current intercept from pipeline_thresholds
      const { data: existing } = await supabase
        .from("pipeline_thresholds")
        .select("value")
        .eq("dimension", "predictor.beta.intercept")
        .maybeSingle();
      const currentBeta = (existing?.value as number | null) ?? 12.0;

      const alpha = 0.3;
      const newBeta = alpha * observedIntercept + (1 - alpha) * currentBeta;
      upserts.push({
        dimension: "predictor.beta.intercept",
        value: Number(newBeta.toFixed(3)),
        sample_size: walkingRows.length,
        metadata: {
          method: "EWMA(alpha=0.3, beta_observed=mean(log(walking_durations)))",
          observed: Number(observedIntercept.toFixed(3)),
          previous: currentBeta,
        },
      });
    }
  }

  // Persist all upserts in one batch
  if (upserts.length > 0) {
    const { error: upsertErr } = await supabase
      .from("pipeline_thresholds")
      .upsert(
        upserts.map((u) => ({
          dimension: u.dimension,
          value: u.value,
          sample_size: u.sample_size,
          metadata: u.metadata,
          last_computed_at: new Date().toISOString(),
        })),
        { onConflict: "dimension" },
      );
    if (upsertErr) {
      console.error(`[recompute-thresholds] upsert failed: ${upsertErr.message}`);
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }
  }

  console.log(
    `[recompute-thresholds] OK — updated ${upserts.length} thresholds, processed ${telemetry.length} telemetry rows`,
  );
  return NextResponse.json({
    ok: true,
    rowsProcessed: telemetry.length,
    thresholdsUpdated: upserts.length,
    updated: upserts.map((u) => ({
      dimension: u.dimension,
      value: u.value,
      sample_size: u.sample_size,
    })),
  });
}
