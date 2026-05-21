-- 036_pipeline_thresholds.sql
--
-- Auto-tunable thresholds for the self-managing pipeline (Sprint 4,
-- 2026-05-21). Stores latency/quality thresholds that drive :
--   * Quality floors per phase (overrides lib/pipeline-quality-scorer
--     defaults when present)
--   * Predictor coefficients (β intercepts + slopes per feature)
--   * Predictor sigma (log-scale std dev)
--   * Timeout decision threshold (P(timeout)>threshold → downgrade)
--
-- Each row represents ONE threshold dimension, with optional `metadata`
-- documenting how it was computed (sample size, time window, etc.).
--
-- Read path : lib/pipeline-quality-scorer + lib/pipeline-predictor query
-- this table at runtime via 60-second in-memory cache (so we don't add
-- a DB roundtrip per pipeline invocation).
--
-- Write path : cron `cron/recompute-pipeline-thresholds` (Sprint 4.2)
-- runs weekly, aggregates last N=200 runs from pipeline_telemetry, and
-- updates rows here via UPSERT.

CREATE TABLE IF NOT EXISTS pipeline_thresholds (
  dimension          TEXT PRIMARY KEY,
  value              NUMERIC NOT NULL,
  last_computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sample_size        INT,
  metadata           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE pipeline_thresholds IS 'Auto-tunable thresholds for the self-managing pipeline. Updated weekly by cron/recompute-pipeline-thresholds. Read by lib/pipeline-quality-scorer + lib/pipeline-predictor.';

COMMENT ON COLUMN pipeline_thresholds.dimension        IS 'Threshold identifier (e.g. "quality_floor.phase1b", "predictor.beta.radius_km", "predictor.sigma").';
COMMENT ON COLUMN pipeline_thresholds.value            IS 'Current value. For quality floors : [0,1]. For predictor coefficients : log-scale coefficients.';
COMMENT ON COLUMN pipeline_thresholds.last_computed_at IS 'When this value was last recomputed by the cron.';
COMMENT ON COLUMN pipeline_thresholds.sample_size      IS 'Number of telemetry rows used to compute this value. NULL for seed values.';
COMMENT ON COLUMN pipeline_thresholds.metadata         IS 'JSONB { p50, p90, p99, distribution_kind, ... } documenting the computation.';

-- Touch trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION touch_pipeline_thresholds() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_pipeline_thresholds ON pipeline_thresholds;
CREATE TRIGGER trg_touch_pipeline_thresholds
  BEFORE UPDATE ON pipeline_thresholds
  FOR EACH ROW EXECUTE FUNCTION touch_pipeline_thresholds();

-- Seed values (mirror lib/pipeline-quality-scorer DEFAULT_FLOORS and
-- lib/pipeline-predictor SEED_BETA). Cron will overwrite once we have
-- enough telemetry.
INSERT INTO pipeline_thresholds (dimension, value, sample_size, metadata) VALUES
  ('quality_floor.phase1a',      0.30, NULL, '{"source": "seed", "rationale": "low because Perplexity DR failure is tolerable"}'::jsonb),
  ('quality_floor.phase1b',      0.70, NULL, '{"source": "seed", "rationale": "critical, ship would be broken below floor"}'::jsonb),
  ('quality_floor.phase2a',      0.75, NULL, '{"source": "seed", "rationale": "critical, missing riddles = unplayable"}'::jsonb),
  ('quality_floor.phase2b',      0.60, NULL, '{"source": "seed", "rationale": "degrades gracefully, flag review on miss"}'::jsonb),
  ('quality_floor.phase2c',      0.50, NULL, '{"source": "seed", "rationale": "DB insert is binary, photos non-blocking"}'::jsonb),
  ('predictor.beta.intercept',   12.00, NULL, '{"source": "seed", "rationale": "log(160s) walking baseline"}'::jsonb),
  ('predictor.beta.radius_km',    0.012, NULL, '{"source": "seed"}'::jsonb),
  ('predictor.beta.is_roadtrip',  0.50, NULL, '{"source": "seed"}'::jsonb),
  ('predictor.beta.theme_length_100', 0.05, NULL, '{"source": "seed"}'::jsonb),
  ('predictor.beta.has_multi_landmark', 0.40, NULL, '{"source": "seed"}'::jsonb),
  ('predictor.sigma',            0.45, NULL, '{"source": "seed", "rationale": "log-scale std dev of observed runs"}'::jsonb),
  ('predictor.timeout_prob_threshold', 0.20, NULL, '{"source": "seed", "rationale": "P(timeout)>20% triggers sonar-pro downgrade"}'::jsonb)
ON CONFLICT (dimension) DO NOTHING;

-- RLS : only admins can read directly. Service role writes via cron.
ALTER TABLE pipeline_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read pipeline_thresholds"
  ON pipeline_thresholds FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admin_users WHERE admin_users.id = auth.uid()
    )
  );
