-- Pipeline telemetry — capture cost per generation per game.
--
-- Why : after the Aegina v1 incident (16 K€ of dev time on a generation
-- that needed 30 min of patches), we lack visibility on which jeux
-- coûtent cher. This table is the source of truth for "which generation
-- needed retries / cost 3× more than the average / which provider is
-- the bottleneck".
--
-- Granularity : one row per (game, provider, phase) tuple. A single
-- generation typically inserts 4-6 rows (gemini-discovery, claude-
-- narration, claude-final-riddle, elevenlabs-audio, gemini-translation,
-- google-geocode).
--
-- Cost is stored in USD as numeric(10,4) — we don't need fractional
-- cents below tenths of a cent.

CREATE TABLE IF NOT EXISTS pipeline_telemetry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID REFERENCES games(id) ON DELETE CASCADE,
  -- 'discovery' | 'narration' | 'final_riddle' | 'translation' | 'audio' | 'geocoding' | 'other'
  phase           TEXT NOT NULL,
  -- 'gemini' | 'claude' | 'elevenlabs' | 'google_places' | 'perplexity' | 'other'
  provider        TEXT NOT NULL,
  language        TEXT,
  input_tokens    INT,
  output_tokens   INT,
  audio_seconds   NUMERIC(10, 2),
  api_calls       INT NOT NULL DEFAULT 1,
  cost_usd        NUMERIC(10, 4),
  duration_ms     INT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_telemetry_game_id
  ON pipeline_telemetry (game_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_telemetry_created_at
  ON pipeline_telemetry (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_telemetry_provider
  ON pipeline_telemetry (provider, created_at DESC);

-- RLS : seuls les admins peuvent lire. Le service role écrit toujours.
ALTER TABLE pipeline_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read pipeline_telemetry"
  ON pipeline_telemetry FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admin_users WHERE admin_users.id = auth.uid()
    )
  );
