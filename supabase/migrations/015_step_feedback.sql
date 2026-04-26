-- ============================================
-- Step feedback (admin review loop)
-- ============================================
-- Admins thumbs-up / thumbs-down each generated step + free-text comment.
-- Negative feedback is later injected into future generation prompts (RAG)
-- to bias Claude away from patterns that didn't work.

CREATE TABLE IF NOT EXISTS step_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id       UUID NOT NULL REFERENCES game_steps(id) ON DELETE CASCADE,
  game_id       UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,

  -- Rating: -1 thumbs down, 0 neutral, 1 thumbs up
  rating        SMALLINT NOT NULL CHECK (rating IN (-1, 0, 1)),

  -- Free-text reason (especially valuable for negatives)
  comment       TEXT,

  -- Denormalised context, used by the RAG injection at generation time so
  -- we can quickly find "what went wrong on similar themes/cities"
  city          TEXT,
  theme         TEXT,
  answer_type   TEXT,        -- year | number | name
  answer_source TEXT,        -- physical | virtual_ar

  reviewer      TEXT,        -- admin email or 'admin'
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_step_feedback_game ON step_feedback(game_id);
CREATE INDEX IF NOT EXISTS idx_step_feedback_negative ON step_feedback(theme, city) WHERE rating = -1;
CREATE INDEX IF NOT EXISTS idx_step_feedback_created ON step_feedback(created_at DESC);

-- One feedback per (step, reviewer) — re-rating updates the existing row
CREATE UNIQUE INDEX IF NOT EXISTS uniq_step_feedback_step_reviewer
  ON step_feedback(step_id, COALESCE(reviewer, 'admin'));

COMMENT ON TABLE step_feedback IS
  'Admin review of generated steps. Negative feedback is injected into future generation prompts via RAG.';
