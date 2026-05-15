-- Migration 026 — default code_validity_hours passe de 24 à 168 (7 jours)
--
-- ═══════════════════════════════════════════════════════════════════════
-- CONTEXTE — incident Julien Alba 2026-05-15
-- ═══════════════════════════════════════════════════════════════════════
--
-- Julien a acheté un jeu Alba en Italie, démarré à 13:00 Paris, fait
-- 2 stops puis pause déjeuner italien (sérieux : 2h+) + pluie l'après-
-- midi. Son code expirait le lendemain 12:51 — soit 24h après la
-- 1ère utilisation. Insuffisant : si la pluie continue, ou s'il a un
-- empêchement pro, ou s'il veut faire le jeu sur 2 weekends → game over.
--
-- Comparaison concurrentielle (audio-tours marche libre) :
--   Voicemap     : 1 an de validité après achat
--   Detour       : ~30 jours après activation
--   izi.TRAVEL   : illimité
--   Rick Steves  : illimité (gratuit)
--   Oddballtrip  : 24h après activation ← TROP STRICT
--
-- ═══════════════════════════════════════════════════════════════════════
-- CHANGEMENTS
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1. Default de la colonne games.code_validity_hours : 24 → 168 (7 jours)
--    Affecte UNIQUEMENT les futurs INSERT qui n'envoient pas explicitement
--    le champ. Les games existants gardent leur valeur (24 pour walking,
--    264+ pour roadtrip déjà longs).
--
-- 2. Fallback COALESCE dans activate_code : 24 → 168
--    Si un game a code_validity_hours=NULL (legacy avant migration 024),
--    on applique 7 jours au lieu de 24h.
--
-- Note : ne touche PAS aux activation_codes existants (leur expires_at
-- est déjà figé au moment de l'activation). Affecte UNIQUEMENT les
-- futures activations.

-- 1. Default de la colonne
ALTER TABLE games
  ALTER COLUMN code_validity_hours SET DEFAULT 168;

COMMENT ON COLUMN games.code_validity_hours IS
  '⏰ Durée de validité (heures) du code activation APRÈS la première activation. '
  'Default 168h = 7 jours (politique 2026-05-15). '
  'Walking standard : 168h. Roadtrip n jours : (n + 7) × 24h posé par la pipeline. '
  'Si NULL, fallback 168h dans activate_code.';

-- 2. activate_code mis à jour avec fallback à 168h
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

  -- TTL dynamique avec fallback 7 jours (changé de 24 à 168 — migration 026)
  v_validity_hours := COALESCE(v_game.code_validity_hours, 168);

  INSERT INTO game_sessions (
    activation_code_id, game_id, player_name, team_name,
    total_steps, status, started_at
  )
  VALUES (
    v_code.id, v_game.id, p_player_name, COALESCE(p_team_name, v_code.team_name),
    v_step_count, 'pending', NULL
  )
  RETURNING id INTO v_session_id;

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
