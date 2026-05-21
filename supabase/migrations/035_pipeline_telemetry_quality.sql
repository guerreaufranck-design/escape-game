-- 035_pipeline_telemetry_quality.sql
--
-- Augment `pipeline_telemetry` (migration 028) with quality_score
-- columns so Sprint 2.2's quality scorer can persist its breakdown
-- alongside cost/duration metrics.
--
-- Why now : the scorer (`lib/pipeline-quality-scorer.ts`) computes a
-- score in [0, 1] per phase + a detailed breakdown. Persisting these
-- enables :
--   * Sprint 4's weekly cron `recompute-pipeline-thresholds` to learn
--     from historical data (e.g. "phase1b p99 quality_score on roadtrip
--     mixed = 0.82").
--   * Admin observability dashboards to spot quality drift week-over-week.
--   * Alerting when a phase drops > 0.1 below its 7-day rolling median.
--
-- Why a JSONB breakdown instead of separate columns : the scorer
-- weights and sub-criteria evolve. Adding a column per criterion would
-- require a migration for every tuning iteration. JSONB lets us store
-- arbitrary keys + values without schema changes; we trade strict typing
-- for agility.

ALTER TABLE pipeline_telemetry
  ADD COLUMN IF NOT EXISTS quality_score NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS quality_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS quality_floor NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS quality_passes BOOLEAN;

COMMENT ON COLUMN pipeline_telemetry.quality_score     IS 'Aggregate quality score in [0.0, 1.0] computed by lib/pipeline-quality-scorer. NULL = scorer not invoked for this row (legacy / pre-Sprint-2 telemetry).';
COMMENT ON COLUMN pipeline_telemetry.quality_breakdown IS 'JSONB { sub_criterion_name: score_in_0_1 } detailing how the aggregate score was computed. Lets us inspect WHICH criterion failed when a phase drops below floor.';
COMMENT ON COLUMN pipeline_telemetry.quality_floor     IS 'The quality_floor configured for this phase at the time of measurement. Useful when tuning floors retrospectively : compare quality_score against floor of the day.';
COMMENT ON COLUMN pipeline_telemetry.quality_passes    IS 'True iff quality_score >= quality_floor at measurement time. Pre-computed for fast aggregation in dashboards (no need to recompute when floors change).';

CREATE INDEX IF NOT EXISTS idx_pipeline_telemetry_quality
  ON pipeline_telemetry (phase, quality_passes, created_at DESC);

COMMENT ON INDEX idx_pipeline_telemetry_quality IS 'Speeds up "fail rate per phase over last 7d" queries used by Sprint 4 SLO alerting.';
