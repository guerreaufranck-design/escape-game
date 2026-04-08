-- Migration: Separate activation from game start
-- Adds 'pending' status, makes started_at nullable, updates activate_code RPC

-- 1. Update status CHECK constraint to include 'pending'
ALTER TABLE game_sessions DROP CONSTRAINT IF EXISTS game_sessions_status_check;
ALTER TABLE game_sessions ADD CONSTRAINT game_sessions_status_check CHECK (status IN ('pending', 'active', 'completed', 'abandoned'));

-- 2. Make started_at nullable (remove default and NOT NULL)
ALTER TABLE game_sessions ALTER COLUMN started_at DROP DEFAULT;
ALTER TABLE game_sessions ALTER COLUMN started_at DROP NOT NULL;

-- 3. Replace activate_code RPC to create sessions with status='pending' and started_at=NULL
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
  v_existing_session UUID;
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

  -- Check if there's already a session for this code (re-activation)
  SELECT id INTO v_existing_session
  FROM game_sessions
  WHERE activation_code_id = v_code.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_session IS NOT NULL THEN
    -- Return existing session instead of creating a new one
    SELECT * INTO v_game FROM games WHERE id = v_code.game_id;
    SELECT COUNT(*) INTO v_step_count FROM game_steps WHERE game_id = v_game.id;
    RETURN json_build_object(
      'sessionId', v_existing_session,
      'gameTitle', v_game.title,
      'totalSteps', v_step_count
    );
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

  INSERT INTO game_sessions (activation_code_id, game_id, player_name, team_name, total_steps, status, started_at)
  VALUES (v_code.id, v_game.id, p_player_name, COALESCE(p_team_name, v_code.team_name), v_step_count, 'pending', NULL)
  RETURNING id INTO v_session_id;

  UPDATE activation_codes SET current_uses = current_uses + 1 WHERE id = v_code.id;

  RETURN json_build_object(
    'sessionId', v_session_id,
    'gameTitle', v_game.title,
    'totalSteps', v_step_count
  );
END;
$$;
