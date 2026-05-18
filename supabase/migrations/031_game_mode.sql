-- S9 (2026-05-18) — Mode du jeu : city_game (escape game classique) vs
-- city_tour (audio-guide enrichi sans énigmes).
--
-- city_game : flow actuel (énigmes, indices, scan AR, code final)
-- city_tour : narration encyclopédique de chaque lieu, AR orientation
--             conservée, personnages parlants, mais PAS d'énigme à
--             résoudre — c'est un audioguide intelligent qui fait
--             marcher le joueur d'un point d'intérêt à l'autre.
--
-- Phase 1 (cette migration) : juste ajouter la colonne. Tous les jeux
-- existants restent en city_game (default).
-- Phase 2 (à venir) : pipeline de génération alternative + page de choix
-- à l'activation + UI player conditionnelle.

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'city_game';

-- Constraint pour valeurs valides
ALTER TABLE games
  DROP CONSTRAINT IF EXISTS games_mode_check;
ALTER TABLE games
  ADD CONSTRAINT games_mode_check CHECK (mode IN ('city_game', 'city_tour'));

COMMENT ON COLUMN games.mode IS
  'city_game = escape game avec énigmes (default). city_tour = audioguide enrichi sans puzzles.';

CREATE INDEX IF NOT EXISTS idx_games_mode ON games (mode);
