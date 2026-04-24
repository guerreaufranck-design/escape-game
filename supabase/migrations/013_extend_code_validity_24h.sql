-- ============================================
-- Extend activation code validity to 24h after first activation
-- ============================================
-- Previously codes had no expires_at set and therefore never expired.
-- Now: on first activation, expires_at is set to now() + 24 hours, giving
-- the player a generous but bounded window to play and replay (e.g. pause
-- during lunch, resume later same day, come back the next morning).
--
-- Why 24h not 8h: 8h was too short for families with children (need
-- breaks, meals, nap). 24h covers a full tourist day + overnight, which
-- matches real-world usage. Minimal risk of abuse (already gated by
-- is_single_use / max_uses).

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

  -- NEW: set expires_at to now + 24h if not already set (first activation)
  UPDATE activation_codes
  SET current_uses = current_uses + 1,
      expires_at = COALESCE(expires_at, now() + INTERVAL '24 hours')
  WHERE id = v_code.id;

  RETURN json_build_object(
    'sessionId', v_session_id,
    'gameTitle', v_game.title,
    'totalSteps', v_step_count
  );
END;
$$;
