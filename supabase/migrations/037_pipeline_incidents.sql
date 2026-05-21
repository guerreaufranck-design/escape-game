-- 037_pipeline_incidents.sql
--
-- Pipeline incidents log — the substrate for case-based learning
-- (Sprint 6, 2026-05-21).
--
-- ════════════════════════════════════════════════════════════════════
-- Purpose
-- ════════════════════════════════════════════════════════════════════
--
-- Captures every situation where the pipeline produced an output that
-- triggered a correction signal, regardless of source :
--
--   * sanity_check_fail : built-in validators (cluster centroid,
--     gps_out_of_cluster, sources_thin, …) flagged the game
--   * quality_floor_miss : a phase scored below its quality_floor
--   * player_report : a player submitted an error report via the
--     in-game button → LLM classifier mapped it to a typed category
--   * manual_operator : operator opened the admin queue and triaged
--     a game directly
--
-- Each incident captures :
--   - the pipeline_context (theme/city/mode/radius/…) at generation
--   - the flagged_features (which values triggered the flag)
--   - the operator_actions taken to resolve it
--   - the resolution status
--   - eventually, the player_outcome (populated days later)
--
-- Sprint 6.3's pattern extractor reads this table to mine recurring
-- patterns → learned_rules → preventive application on future runs.
--
-- ════════════════════════════════════════════════════════════════════
-- Schema notes
-- ════════════════════════════════════════════════════════════════════
--
-- All semantic fields are JSONB to allow the schema to evolve without
-- migrations every time we add a feature. The cost is slightly slower
-- analytics queries, but the dataset stays small (1-2 rows per game)
-- so it's acceptable.
--
-- `error_signature` is a free-form TEXT column. We document the
-- conventional values in code (see lib/error-signatures.ts to be added
-- in Sprint 6.3) but allow extensibility — operators can categorize
-- new failure modes without DB migrations.

CREATE TABLE IF NOT EXISTS pipeline_incidents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id           UUID REFERENCES games(id) ON DELETE SET NULL,
  step_id           UUID REFERENCES game_steps(id) ON DELETE SET NULL,
  trigger_type      TEXT NOT NULL CHECK (trigger_type IN (
                      'sanity_check_fail',
                      'quality_floor_miss',
                      'player_report',
                      'manual_operator'
                    )),
  error_signature   TEXT NOT NULL,
  pipeline_context  JSONB,
  flagged_features  JSONB,
  operator_actions  JSONB DEFAULT '[]'::jsonb,
  resolution        TEXT NOT NULL DEFAULT 'pending' CHECK (resolution IN (
                      'pending',
                      'auto_rectified',
                      'admin_resolved',
                      'released_with_issue',
                      'rejected'
                    )),
  player_outcome    JSONB,
  source_report_id  UUID REFERENCES error_reports(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);

COMMENT ON TABLE pipeline_incidents IS
  'Substrate for case-based learning. Every correction signal (sanity-check, quality-floor miss, player report, manual intervention) becomes one row here. Sprint 6.3 pattern extractor mines this table to generate learned_rules.';

COMMENT ON COLUMN pipeline_incidents.trigger_type IS
  'Origin of the incident — drives downstream classification logic.';
COMMENT ON COLUMN pipeline_incidents.error_signature IS
  'Free-form typed category (e.g. "narrative_offset_present", "sources_thin", "wrong_gps", "audio_text_mismatch"). Documented in lib/error-signatures.ts.';
COMMENT ON COLUMN pipeline_incidents.pipeline_context IS
  'JSONB snapshot of generation parameters : theme, city, transport_mode, radius_km, stop_count, mode, etc. Used by pattern extractor to cluster similar contexts.';
COMMENT ON COLUMN pipeline_incidents.flagged_features IS
  'JSONB of the specific measurements that triggered the flag : { narrative_offset_count, centroid_drift_m, sources_thin_ratio, … }.';
COMMENT ON COLUMN pipeline_incidents.operator_actions IS
  'JSONB array of typed operator actions applied (cf. lib/operator-actions.ts). [] when no action taken yet.';
COMMENT ON COLUMN pipeline_incidents.resolution IS
  'Lifecycle : pending → (auto_rectified | admin_resolved | released_with_issue | rejected).';
COMMENT ON COLUMN pipeline_incidents.player_outcome IS
  'JSONB populated later by player sessions data : { completion_rate, hints_used_ratio, time_vs_estimated, nps, n_subsequent_reports_on_same_step }. NULL until outcome data accrues.';
COMMENT ON COLUMN pipeline_incidents.source_report_id IS
  'Pointer to error_reports row when trigger_type=player_report. Lets us join report→incident.';

-- ────────────────────────────────────────────────────────────────────
-- Indexes — speed up the cron extractor + admin queue queries
-- ────────────────────────────────────────────────────────────────────

-- Pattern extractor groups by signature + resolution
CREATE INDEX IF NOT EXISTS idx_pipeline_incidents_signature_resolution
  ON pipeline_incidents (error_signature, resolution, created_at DESC);

-- Admin queue lists by resolution status
CREATE INDEX IF NOT EXISTS idx_pipeline_incidents_resolution
  ON pipeline_incidents (resolution, created_at DESC);

-- Lookup by game
CREATE INDEX IF NOT EXISTS idx_pipeline_incidents_game
  ON pipeline_incidents (game_id);

-- Pattern extractor needs to group by trigger source
CREATE INDEX IF NOT EXISTS idx_pipeline_incidents_trigger
  ON pipeline_incidents (trigger_type, created_at DESC);

-- ────────────────────────────────────────────────────────────────────
-- RLS — admins only
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE pipeline_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read pipeline_incidents"
  ON pipeline_incidents FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.id = auth.uid()));

CREATE POLICY "admins update pipeline_incidents"
  ON pipeline_incidents FOR UPDATE
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.id = auth.uid()));

-- ════════════════════════════════════════════════════════════════════
-- auto_rectification_log : reversibility safety net
-- ════════════════════════════════════════════════════════════════════
--
-- Every auto-rectification action records the BEFORE state here, so
-- the admin can revert a bad auto-fix with one click. Without this,
-- auto-correcting is too risky to ever enable.

CREATE TABLE IF NOT EXISTS auto_rectification_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id       UUID REFERENCES pipeline_incidents(id) ON DELETE CASCADE,
  game_id           UUID REFERENCES games(id) ON DELETE CASCADE,
  step_id           UUID REFERENCES game_steps(id) ON DELETE SET NULL,
  action_type       TEXT NOT NULL,  -- e.g. 'rectifyWrongGps', 'rectifyAudioTextMismatch'
  before_state      JSONB NOT NULL,  -- snapshot of affected DB rows before change
  after_state       JSONB NOT NULL,  -- snapshot after change
  applied_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reverted_at       TIMESTAMPTZ,
  reverted_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revert_reason     TEXT
);

COMMENT ON TABLE auto_rectification_log IS
  'Audit + reversibility log for every auto-rectification. before_state lets admin restore the DB exactly via UI "Revert" button.';

CREATE INDEX IF NOT EXISTS idx_auto_rectification_incident
  ON auto_rectification_log (incident_id);
CREATE INDEX IF NOT EXISTS idx_auto_rectification_game_unreverted
  ON auto_rectification_log (game_id, applied_at DESC)
  WHERE reverted_at IS NULL;

ALTER TABLE auto_rectification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read auto_rectification_log"
  ON auto_rectification_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.id = auth.uid()));

CREATE POLICY "admins update auto_rectification_log"
  ON auto_rectification_log FOR UPDATE
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.id = auth.uid()));
