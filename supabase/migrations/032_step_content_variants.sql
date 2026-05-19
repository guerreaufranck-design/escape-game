-- =============================================================
-- Migration 032 — Content variants for city_game / city_tour
-- =============================================================
-- Vision 2026-05-19 : on transforme S9 (mode flag) en VRAIE
-- divergence produit. Le tour mode n'est plus juste un toggle UI,
-- c'est une expérience à part entière avec contenu propre.
--
-- Approche non-destructive : on AJOUTE step_content sans toucher
-- aux colonnes existantes de game_steps. Les jeux escape existants
-- continuent de lire game_steps directement. Les NOUVEAUX jeux
-- (escape ET tour) écrivent dans step_content. À terme, on migrera
-- les jeux existants vers step_content puis on dropera les colonnes
-- redondantes de game_steps. Pour l'instant, dette technique
-- temporaire acceptable.
--
-- Tables créées :
--   - step_content   : couche narrative différenciée par mode + langue
--   - step_commerce  : liens d'achat tickets (GYG, Tiqets…) par stop
--
-- Tables modifiées :
--   - games          : extends mode CHECK pour 'both' + min/max stops
--   - game_sessions  : ajoute played_mode (override per-session)
--   - audio_cache    : ajoute mode pour distinguer les audios
--   - translations_cache : ajoute mode pour distinguer les traductions

-- ──────────────────────────────────────────────────────────────
-- step_content : contenu narratif différencié par (step, mode, langue)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS step_content (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id               UUID NOT NULL REFERENCES game_steps(id) ON DELETE CASCADE,
  mode                  TEXT NOT NULL CHECK (mode IN ('city_game', 'city_tour')),
  language              TEXT NOT NULL,

  -- COMMUN aux deux modes
  title                 TEXT NOT NULL,
  landmark_history      TEXT NOT NULL,
  anecdote              TEXT NOT NULL,

  -- ESCAPE uniquement (NULL en city_tour)
  riddle_text           TEXT,
  hints                 JSONB,
  answer                TEXT,
  answer_source         TEXT CHECK (answer_source IS NULL OR answer_source IN ('physical', 'virtual_ar')),
  ar_character          JSONB,
  ar_facade_text        TEXT,
  ar_treasure_reward    TEXT,

  -- TOUR uniquement (NULL en city_game)
  encyclopedic_text     TEXT,      -- narration riche 200-300 mots
  architectural_focus   TEXT,      -- ce qu'il faut regarder en détail
  cultural_connection   TEXT,      -- lien avec les autres lieux du parcours

  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),

  UNIQUE (step_id, mode, language)
);

CREATE INDEX idx_step_content_step_mode ON step_content (step_id, mode);
CREATE INDEX idx_step_content_language ON step_content (language);

COMMENT ON TABLE step_content IS
  'Contenu narratif par stop, mode et langue. Permet à un même squelette de game_steps (mêmes coords GPS) de servir deux expériences distinctes : city_game (énigmes courtes) ou city_tour (narration encyclopédique riche).';

-- ──────────────────────────────────────────────────────────────
-- step_commerce : ticketing & upsells par stop (porte ouverte
-- vers GetYourGuide, Tiqets, Booking, etc.)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS step_commerce (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id         UUID NOT NULL REFERENCES game_steps(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,              -- 'getyourguide' | 'tiqets' | 'direct' | 'booking' | 'viator'
  product_type    TEXT,                       -- 'entry_ticket' | 'guided_tour' | 'experience' | 'skip_the_line'
  product_name    TEXT NOT NULL,              -- "Billet coupe-file Louvre"
  product_url     TEXT NOT NULL,              -- URL affiliate-tagged
  price_eur       NUMERIC(6,2),
  duration_min    INTEGER,
  thumbnail_url   TEXT,
  display_order   INTEGER DEFAULT 0,
  active          BOOLEAN DEFAULT TRUE,
  -- Visibilité par mode : un upsell peut être pertinent en tour mode
  -- (audioguide → "tu veux entrer ?") mais hors-sujet en escape
  -- (le joueur cherche l'indice, pas une croisière).
  show_in_modes   TEXT[] DEFAULT ARRAY['city_tour']::TEXT[],
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_step_commerce_step ON step_commerce (step_id) WHERE active;
CREATE INDEX idx_step_commerce_provider ON step_commerce (provider) WHERE active;

COMMENT ON TABLE step_commerce IS
  'Liens d''achat tickets/expériences par stop. Multi-provider (GYG, Tiqets, Booking, direct). Désactivation via flag active=FALSE (jamais DELETE pour garder l''historique). show_in_modes contrôle l''affichage : par défaut tour-only.';

-- ──────────────────────────────────────────────────────────────
-- games : extends mode CHECK + stop counts flexibles
-- ──────────────────────────────────────────────────────────────
-- Ajoute le mode 'both' pour les jeux qui supportent les DEUX
-- expériences (option future pour pack 2-en-1). Pour l'instant,
-- seuls 'city_game' et 'city_tour' sont émis par la pipeline.
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_mode_check;
ALTER TABLE games
  ADD CONSTRAINT games_mode_check
  CHECK (mode IN ('city_game', 'city_tour', 'both'));

-- Stop count flexible pour city_tour. Les city_game restent
-- clampés à [6, 9] côté pipeline. Les city_tour vont [6, max_stops].
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS max_stops INTEGER DEFAULT 9
  CHECK (max_stops BETWEEN 6 AND 25);

COMMENT ON COLUMN games.max_stops IS
  'Plafond du nombre de stops. 9 pour city_game (escape gardé compact), jusqu''à 18-20 pour city_tour (richesse encyclopédique). Plancher 6 toujours appliqué côté pipeline.';

-- ──────────────────────────────────────────────────────────────
-- game_sessions : played_mode (override session-level si game.mode='both')
-- ──────────────────────────────────────────────────────────────
-- Si game.mode='both', le joueur choisit son mode sur la PWA après
-- activation. Ce choix est mémorisé ici. Si game.mode='city_game'
-- ou 'city_tour', played_mode reste NULL (héritage automatique).
ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS played_mode TEXT
  CHECK (played_mode IS NULL OR played_mode IN ('city_game', 'city_tour'));

COMMENT ON COLUMN game_sessions.played_mode IS
  'Mode choisi par le joueur si game.mode=''both''. NULL = on hérite de game.mode.';

-- ──────────────────────────────────────────────────────────────
-- audio_cache : ajout du mode (séparer les MP3 escape vs tour)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE audio_cache
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'city_game'
  CHECK (mode IN ('city_game', 'city_tour'));

-- Réindex le composite pour intégrer le mode. La colonne réelle est
-- `slot` (cf. migration 018) et pas audio_type. L'ancien index
-- (game_id, language) reste valide pour les jeux existants city_game.
CREATE INDEX IF NOT EXISTS idx_audio_cache_mode_lookup
  ON audio_cache (game_id, step_order, slot, language, mode);

-- ──────────────────────────────────────────────────────────────
-- translations_cache : ajout du mode
-- ──────────────────────────────────────────────────────────────
-- Même logique : un même text_source_id peut avoir des traductions
-- distinctes selon mode (le riddle escape vs le encyclopedic tour).
ALTER TABLE translations_cache
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'city_game'
  CHECK (mode IN ('city_game', 'city_tour'));

CREATE INDEX IF NOT EXISTS idx_translations_cache_mode_lookup
  ON translations_cache (source_id, source_field, language, mode);
