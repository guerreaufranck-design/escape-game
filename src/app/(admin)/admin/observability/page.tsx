/**
 * Admin observability page (Sprint 4.3, 2026-05-21).
 *
 * Server-rendered snapshot of pipeline SLO health. Reads via the
 * `/api/admin/observability` endpoint logic inlined here for efficiency
 * (no extra HTTP roundtrip). Displays :
 *
 *   * SLO indicator : success rate of critical phases over last 7d
 *     vs 95% target. Red badge if degraded.
 *   * Per-phase table : success rate, p50/p99 quality, p50/p99 duration.
 *   * Current pipeline_thresholds (with last_computed_at + sample_size).
 *   * Recent failures (last 20 quality_passes=false rows).
 *
 * Auth handled by `(admin)/layout.tsx`.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";

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

export default async function ObservabilityPage() {
  const supabase = createAdminClient();

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rowsRaw } = await supabase
    .from("pipeline_telemetry")
    .select(
      "phase, duration_ms, quality_score, quality_passes, metadata, created_at",
    )
    .gte("created_at", since)
    .not("quality_score", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);

  const rows = (rowsRaw ?? []) as Row[];

  const byPhase: Record<string, Row[]> = {};
  for (const r of rows) {
    const phaseId =
      (r.metadata?.phase_id as string | undefined) ?? r.phase ?? "other";
    byPhase[phaseId] = byPhase[phaseId] ?? [];
    byPhase[phaseId].push(r);
  }

  const phases = Object.entries(byPhase).map(([phaseId, rs]) => {
    const passing = rs.filter((r) => r.quality_passes === true).length;
    const total = rs.length;
    const qualities = rs.map((r) => r.quality_score!).filter(Number.isFinite);
    const durations = rs.map((r) => r.duration_ms ?? 0).filter((v) => v > 0);
    return {
      phase: phaseId,
      total,
      success_rate: total > 0 ? passing / total : 0,
      quality_p50: percentile(qualities, 0.5),
      quality_p99: percentile(qualities, 0.99),
      duration_p50_ms: percentile(durations, 0.5),
      duration_p99_ms: percentile(durations, 0.99),
    };
  });
  phases.sort((a, b) => a.phase.localeCompare(b.phase));

  const critical = phases.filter((p) =>
    ["phase1b", "phase2a", "phase2c"].includes(p.phase),
  );
  const criticalTotal = critical.reduce((s, p) => s + p.total, 0);
  const criticalPassing = critical.reduce(
    (s, p) => s + Math.round(p.success_rate * p.total),
    0,
  );
  const sloObserved = criticalTotal > 0 ? criticalPassing / criticalTotal : 1;
  const SLO_TARGET = 0.95;
  const sloHealthy = sloObserved >= SLO_TARGET;

  const { data: thresholdsRaw } = await supabase
    .from("pipeline_thresholds")
    .select("dimension, value, sample_size, last_computed_at")
    .order("dimension");
  const thresholds = thresholdsRaw ?? [];

  const recentFailures = rows
    .filter((r) => r.quality_passes === false)
    .slice(0, 20);

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <header>
        <h1 className="text-2xl font-bold">Pipeline observability</h1>
        <p className="text-sm text-gray-600">
          7-day rolling window · {rows.length} telemetry rows ·{" "}
          <Link href="/admin" className="text-blue-600 hover:underline">
            ← back to admin
          </Link>
        </p>
      </header>

      {/* SLO indicator */}
      <section className="border rounded-lg p-6 bg-white shadow-sm">
        <h2 className="text-lg font-semibold mb-3">SLO health</h2>
        <div className="flex items-baseline gap-4">
          <div className="text-4xl font-mono">
            {(sloObserved * 100).toFixed(1)}%
          </div>
          <div className="text-sm text-gray-600">
            critical phases success rate · target {SLO_TARGET * 100}%
          </div>
          <div
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              sloHealthy
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {sloHealthy ? "✓ healthy" : "⚠ degraded"}
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Computed over phase1b + phase2a + phase2c ({criticalTotal} samples).
          Excludes non-critical phases (1a, 2b) which degrade gracefully.
        </p>
      </section>

      {/* Per-phase metrics */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Per-phase metrics</h2>
        <div className="overflow-x-auto border rounded-lg bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2">Phase</th>
                <th className="text-right px-4 py-2">N</th>
                <th className="text-right px-4 py-2">Success rate</th>
                <th className="text-right px-4 py-2">Quality p50</th>
                <th className="text-right px-4 py-2">Quality p99</th>
                <th className="text-right px-4 py-2">Duration p50</th>
                <th className="text-right px-4 py-2">Duration p99</th>
              </tr>
            </thead>
            <tbody>
              {phases.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                    No telemetry yet. Run a few games — Sprint 2.3 will populate
                    this table within ~1 minute of each pipeline phase.
                  </td>
                </tr>
              )}
              {phases.map((p) => (
                <tr key={p.phase} className="border-t">
                  <td className="px-4 py-2 font-mono">{p.phase}</td>
                  <td className="text-right px-4 py-2">{p.total}</td>
                  <td className="text-right px-4 py-2">
                    <span
                      className={
                        p.success_rate >= 0.95
                          ? "text-green-700"
                          : p.success_rate >= 0.85
                            ? "text-yellow-700"
                            : "text-red-700"
                      }
                    >
                      {(p.success_rate * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="text-right px-4 py-2 font-mono">
                    {p.quality_p50.toFixed(2)}
                  </td>
                  <td className="text-right px-4 py-2 font-mono">
                    {p.quality_p99.toFixed(2)}
                  </td>
                  <td className="text-right px-4 py-2 font-mono">
                    {Math.round(p.duration_p50_ms / 1000)}s
                  </td>
                  <td className="text-right px-4 py-2 font-mono">
                    {Math.round(p.duration_p99_ms / 1000)}s
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Current thresholds */}
      <section>
        <h2 className="text-lg font-semibold mb-3">
          Current thresholds (auto-tuned weekly)
        </h2>
        <div className="overflow-x-auto border rounded-lg bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2">Dimension</th>
                <th className="text-right px-4 py-2">Value</th>
                <th className="text-right px-4 py-2">Sample size</th>
                <th className="text-left px-4 py-2">Last computed</th>
              </tr>
            </thead>
            <tbody>
              {thresholds.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    Migration 036 not applied yet. Run the SQL in Supabase.
                  </td>
                </tr>
              )}
              {thresholds.map((t) => (
                <tr key={t.dimension} className="border-t">
                  <td className="px-4 py-2 font-mono text-xs">{t.dimension}</td>
                  <td className="text-right px-4 py-2 font-mono">
                    {Number(t.value).toFixed(3)}
                  </td>
                  <td className="text-right px-4 py-2 text-gray-500">
                    {t.sample_size ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-500 text-xs">
                    {new Date(t.last_computed_at).toLocaleString("fr-FR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent failures */}
      {recentFailures.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 text-red-700">
            Recent quality-gate failures ({recentFailures.length})
          </h2>
          <div className="space-y-2">
            {recentFailures.map((r, i) => (
              <div
                key={i}
                className="border-l-4 border-red-400 bg-red-50 px-4 py-2 text-sm"
              >
                <div className="flex justify-between font-mono">
                  <span>
                    {(r.metadata?.phase_id as string | undefined) ?? r.phase}
                  </span>
                  <span className="text-red-700">
                    score {r.quality_score?.toFixed(2)}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {new Date(r.created_at).toLocaleString("fr-FR")} ·{" "}
                  {r.metadata
                    ? Object.entries(r.metadata)
                        .filter(([k]) => k !== "weights")
                        .map(([k, v]) => `${k}=${String(v).slice(0, 30)}`)
                        .join(" · ")
                    : ""}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
