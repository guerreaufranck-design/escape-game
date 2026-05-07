-- Migration : flag de review post-génération
--
-- Ajouté pour la Phase 4 de la généralisation startPoint validation
-- (cf. plan 2026-05-07). Le pipeline pose `needs_review = true` quand
-- une sanity-check post-discovery détecte une anomalie (typiquement
-- centroïde du parcours > 5 km du body.startPoint = signal "label SEO
-- pris pour zone-jeu" type Brest centre vs. Pointe Saint-Mathieu).
--
-- Le jeu est tout de même publié (le widening + la curation Claude
-- ont fait au mieux), mais l'opérateur DOIT inspecter via dump-game
-- avant de libérer le code activation au client. Le flag persiste
-- même si le callback oddballtrip est raté.
--
-- Workflow :
--   1. Pipeline insert game → calcule centroïde des stops vs startPoint
--   2. Si distance > 5 km → needs_review=true + review_reason renseigné
--   3. Callback oddballtrip inclut needsReview=true → file de review
--   4. Operator : npx tsx scripts/dump-game.ts <slug> → édite si besoin
--   5. Operator : UPDATE games SET needs_review=false WHERE id=...  (ou via futur script `release-game`)
--   6. oddballtrip libère le code activation au client

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS review_reason TEXT;

-- Index partiel : seules les rows qui ont besoin de review sont indexées
-- (= 0 % du catalogue en régime nominal). Coût stockage négligeable,
-- requête operator ultra-rapide.
CREATE INDEX IF NOT EXISTS idx_games_needs_review
  ON public.games (needs_review)
  WHERE needs_review = TRUE;

COMMENT ON COLUMN public.games.needs_review IS
  'TRUE quand la sanity-check post-discovery a détecté une anomalie (ex. centroïde des stops > 5 km du body.startPoint). Operator inspecte via dump-game et libère via UPDATE games SET needs_review=false.';

COMMENT ON COLUMN public.games.review_reason IS
  'Message human-readable expliquant pourquoi le jeu a été flaggé. Posé par le pipeline à l''insert. Vidé manuellement après review.';
