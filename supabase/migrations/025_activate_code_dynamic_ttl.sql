-- Migration : activate_code lit games.code_validity_hours
--
-- Avant : code expirait now() + 24h (hardcodé migration 013), suffisant
-- pour walking 90 min mais NETTEMENT trop court pour un roadtrip
-- 2-4 jours où le client doit pouvoir étaler le jeu sur la semaine.
--
-- Maintenant : la fonction lit la colonne games.code_validity_hours
-- (ajoutée dans migration 024) et applique le TTL dynamiquement.
--
--   walking (default)    : 24h
--   roadtrip 2-4 jours   : ~264h ((4+7) × 24)
--   roadtrip 6 jours     : ~312h ((6+7) × 24)
--
-- Logic métier : durée_max + 7 jours de marge pour qu'un client qui
-- prend du retard (panne, mauvais temps, contraintes pro) puisse
-- toujours finir.

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
  v_validity_hours INTEGER;
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

  -- Re-activation : retourne la session existante telle quelle
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

  -- TTL dynamique : lit code_validity_hours sur le jeu (default 24h
  -- via la colonne, donc fallback robuste). Pour les jeux roadtrip,
  -- la pipeline pose typiquement 264h (2-4 jours + 7 marge).
  v_validity_hours := COALESCE(v_game.code_validity_hours, 24);

  INSERT INTO game_sessions (
    activation_code_id, game_id, player_name, team_name,
    total_steps, status, started_at
  )
  VALUES (
    v_code.id, v_game.id, p_player_name, COALESCE(p_team_name, v_code.team_name),
    v_step_count, 'pending', NULL
  )
  RETURNING id INTO v_session_id;

  -- Pose expires_at = now() + validity_hours si pas déjà set.
  -- Cast en interval via make_interval pour éviter SQL injection
  -- même si v_validity_hours vient d'une colonne typée.
  UPDATE activation_codes
  SET current_uses = current_uses + 1,
      expires_at = COALESCE(
        expires_at,
        now() + make_interval(hours => v_validity_hours)
      )
  WHERE id = v_code.id;

  RETURN json_build_object(
    'sessionId', v_session_id,
    'gameTitle', v_game.title,
    'totalSteps', v_step_count
  );
END;
$$;
