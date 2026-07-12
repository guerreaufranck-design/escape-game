-- 044 — Décodage sur place (Phase 1 "puzzle mode").
-- À chaque stop l'RA dévoile 2-3 mots (reveal_words) ; le joueur DÉDUIT la
-- réponse (answer_text). puzzle_type NULL = comportement legacy inchangé
-- (l'RA révèle directement la réponse). Additif, rétrocompatible.

ALTER TABLE public.game_steps
  ADD COLUMN IF NOT EXISTS puzzle_type TEXT
    CHECK (puzzle_type IN ('ACROSTIC', 'ANAGRAM', 'ASSOCIATION')),
  ADD COLUMN IF NOT EXISTS reveal_words JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.game_steps.puzzle_type IS
  'Type d''énigme de déchiffrage (ACROSTIC|ANAGRAM|ASSOCIATION). NULL = legacy (RA révèle la réponse).';
COMMENT ON COLUMN public.game_steps.reveal_words IS
  'Mots dévoilés par l''RA à l''arrivée (le joueur en déduit answer_text). [] en mode legacy.';
