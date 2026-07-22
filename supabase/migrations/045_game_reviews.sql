-- 045 — Avis joueurs de fin de partie (étoiles + texte).
--
-- Mécanique produit :
--   - À la fin du jeu, le joueur note 1-5★ + laisse un avis texte.
--   - 4-5★  → is_public = true  → affichés comme TÉMOIGNAGES sur la page
--             publique white-label /avis/[slug] (SANS note moyenne chiffrée,
--             pour rester conforme aux plateformes / FTC-UE).
--   - 1-3★  → is_public = false → traités en INTERNE (admin) + alerte email
--             pour rappeler le client (service recovery).
--
-- White-label : brand_key = oddballtrip | surlestraces | rumbosecreto
-- (dérivé du préfixe du slug du jeu).

CREATE TABLE IF NOT EXISTS game_reviews (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id      UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  session_id   UUID REFERENCES game_sessions(id) ON DELETE SET NULL,
  rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text  TEXT,
  player_name  TEXT,
  language     TEXT,
  brand_key    TEXT,
  -- 4-5★ = public. Dénormalisé (au lieu d'un calcul rating>=4) pour permettre
  -- à l'admin de dépublier manuellement un avis public si besoin.
  is_public    BOOLEAN NOT NULL DEFAULT false,
  -- Suivi interne des avis bas.
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'handled', 'archived')),
  admin_notes  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Page publique : avis publics d'un jeu, du plus récent au plus ancien.
CREATE INDEX IF NOT EXISTS idx_game_reviews_public
  ON game_reviews (game_id, created_at DESC)
  WHERE is_public = true;

-- File de gestion interne : avis bas non encore traités.
CREATE INDEX IF NOT EXISTS idx_game_reviews_todo
  ON game_reviews (created_at DESC)
  WHERE is_public = false AND status = 'new';

-- Un seul avis par session (le joueur peut corriger sa note → upsert).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_game_reviews_session
  ON game_reviews (session_id)
  WHERE session_id IS NOT NULL;

-- Tout l'accès passe par le client service-role côté serveur (API Next.js).
-- On active RLS sans policy publique → l'accès anon direct est bloqué.
ALTER TABLE game_reviews ENABLE ROW LEVEL SECURITY;
