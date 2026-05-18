-- Cooldown timestamp pour le cron `process-pending-games`.
--
-- Sans ce champ, le cron retape `finalizeGame` toutes les minutes sur
-- les games qui ont needs_review=false mais une issue persistante
-- (audio_failed > 0, translation_incomplete, etc.). Chaque appel
-- déclenche un re-run de validateFinalGame qui inclut B3 cross-validation
-- = 8 appels Google Places à $0.024 chacun.
--
-- Avec un cooldown de 15 min, on limite à 4 tentatives / heure / game
-- au lieu de 60. Réduction des coûts × 15.
--
-- Observed 2026-05-18 : Lille game looped 198 fois en 3h → $38 brûlés
-- en Google Places juste pour ce game.

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS last_finalize_at TIMESTAMPTZ;

COMMENT ON COLUMN games.last_finalize_at IS
  'Last time finalizeGame() ran on this game. Used by cron/process-pending-games to enforce a 15-min cooldown between attempts on the same game, preventing API cost runaway.';

-- Index pour le filtrage cron (WHERE last_finalize_at IS NULL OR < cutoff)
CREATE INDEX IF NOT EXISTS idx_games_last_finalize_at
  ON games (last_finalize_at)
  WHERE is_published = false;
