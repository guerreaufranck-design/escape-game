-- ============================================
-- Escape Game Outdoor - Database Schema
-- ============================================

-- Games / Scenarios
CREATE TABLE games (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 TEXT NOT NULL,
  description           TEXT,
  cover_image           TEXT,
  city                  TEXT,
  difficulty            SMALLINT DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  estimated_duration_min INTEGER,
  is_published          BOOLEAN DEFAULT FALSE,
  max_hints_per_step    SMALLINT DEFAULT 3,
  hint_penalty_seconds  INTEGER DEFAULT 120,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- Game Steps / Checkpoints
CREATE TABLE game_steps (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                   UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  step_order                SMALLINT NOT NULL,
  title                     TEXT NOT NULL,
  riddle_text               TEXT NOT NULL,
  riddle_image              TEXT,
  answer_text               TEXT,
  latitude                  DOUBLE PRECISION NOT NULL,
  longitude                 DOUBLE PRECISION NOT NULL,
  validation_radius_meters  INTEGER DEFAULT 30,
  has_photo_challenge       BOOLEAN DEFAULT FALSE,
  photo_reference           TEXT,
  hints                     JSONB DEFAULT '[]'::JSONB,
  bonus_time_seconds        INTEGER DEFAULT 0,
  created_at                TIMESTAMPTZ DEFAULT now(),
  UNIQUE (game_id, step_order)
);

CREATE INDEX idx_game_steps_game_id ON game_steps(game_id);

-- Activation Codes
CREATE TABLE activation_codes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,
  game_id       UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  is_single_use BOOLEAN DEFAULT TRUE,
  max_uses      INTEGER DEFAULT 1,
  current_uses  INTEGER DEFAULT 0,
  team_name     TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  created_by    UUID
);

CREATE INDEX idx_activation_codes_code ON activation_codes(code);
CREATE INDEX idx_activation_codes_game_id ON activation_codes(game_id);

-- Game Sessions
CREATE TABLE game_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_code_id    UUID NOT NULL REFERENCES activation_codes(id),
  game_id               UUID NOT NULL REFERENCES games(id),
  player_name           TEXT NOT NULL,
  team_name             TEXT,
  status                TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  current_step          SMALLINT DEFAULT 1,
  total_steps           SMALLINT NOT NULL,
  started_at            TIMESTAMPTZ DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  total_time_seconds    INTEGER,
  total_hints_used      INTEGER DEFAULT 0,
  total_penalty_seconds INTEGER DEFAULT 0,
  final_score           INTEGER,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_game_sessions_game_id ON game_sessions(game_id);
CREATE INDEX idx_game_sessions_status ON game_sessions(status);

-- Step Completions
CREATE TABLE step_completions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  step_id         UUID NOT NULL REFERENCES game_steps(id),
  step_order      SMALLINT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ DEFAULT now(),
  time_seconds    INTEGER,
  hints_used      SMALLINT DEFAULT 0,
  penalty_seconds INTEGER DEFAULT 0,
  photo_url       TEXT,
  photo_validated BOOLEAN,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  distance_meters DOUBLE PRECISION,
  UNIQUE (session_id, step_id)
);

CREATE INDEX idx_step_completions_session_id ON step_completions(session_id);

-- Admin Users
CREATE TABLE admin_users (
  id          UUID PRIMARY KEY,
  role        TEXT DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Leaderboard View
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  gs.id AS session_id,
  gs.player_name,
  gs.team_name,
  g.id AS game_id,
  g.title AS game_title,
  g.city,
  gs.total_time_seconds,
  gs.total_hints_used,
  gs.total_penalty_seconds,
  gs.final_score,
  gs.completed_at,
  RANK() OVER (PARTITION BY g.id ORDER BY gs.final_score DESC, gs.total_time_seconds ASC) AS rank
FROM game_sessions gs
JOIN games g ON g.id = gs.game_id
WHERE gs.status = 'completed' AND gs.final_score IS NOT NULL;

-- Atomic code activation function
CREATE OR REPLACE FUNCTION activate_code(
  p_code TEXT,
  p_player_name TEXT,
  p_team_name TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code activation_codes%ROWTYPE;
  v_game games%ROWTYPE;
  v_step_count INTEGER;
  v_session_id UUID;
BEGIN
  SELECT * INTO v_code
  FROM activation_codes
  WHERE UPPER(code) = UPPER(p_code)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Code invalide');
  END IF;

  IF v_code.expires_at IS NOT NULL AND v_code.expires_at < now() THEN
    RETURN json_build_object('error', 'Code expire');
  END IF;

  IF v_code.is_single_use AND v_code.current_uses >= 1 THEN
    RETURN json_build_object('error', 'Code deja utilise');
  END IF;

  IF v_code.current_uses >= v_code.max_uses THEN
    RETURN json_build_object('error', 'Nombre maximum d''utilisations atteint');
  END IF;

  SELECT * INTO v_game FROM games WHERE id = v_code.game_id AND is_published = true;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Jeu non disponible');
  END IF;

  SELECT COUNT(*) INTO v_step_count FROM game_steps WHERE game_id = v_game.id;

  INSERT INTO game_sessions (activation_code_id, game_id, player_name, team_name, total_steps)
  VALUES (v_code.id, v_game.id, p_player_name, COALESCE(p_team_name, v_code.team_name), v_step_count)
  RETURNING id INTO v_session_id;

  UPDATE activation_codes SET current_uses = current_uses + 1 WHERE id = v_code.id;

  RETURN json_build_object(
    'sessionId', v_session_id,
    'gameTitle', v_game.title,
    'totalSteps', v_step_count
  );
END;
$$;

-- Auto-update updated_at on games
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER games_updated_at
  BEFORE UPDATE ON games
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
