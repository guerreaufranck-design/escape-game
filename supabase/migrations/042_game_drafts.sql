-- Migration 042 : drafts de jeux pré-validés (catalogue avant vente)
--
-- Stratégie pré-validation (2026-05-24) :
--   1. Pour chaque jeu du catalogue (Funbooker), on pré-valide la zone
--      de friction = landmarks + GPS + diagnostics qualité
--   2. La narration / traduction / audio restent vides, générées à la
--      vente uniquement (économie ~$1/vente + ~5min wait évités)
--   3. La pipeline build-game checke si un draft existe pour le slug ;
--      si oui, skip discovery (Phase 1) et continue avec les stops
--      pré-validés
--
-- Status flow : pending → validated → fulfilling → fulfilled
--   pending    : draft créé, discovery pas encore lancée
--   validated  : runSimpleDiscovery() terminé, stops + diagnostics OK
--   fulfilling : un client vient d'acheter, build en cours
--   fulfilled  : games row insérée, fulfilled_game_id link rempli

CREATE TABLE IF NOT EXISTS game_drafts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identité du jeu (vient d'OddballTrip)
  slug                  TEXT UNIQUE NOT NULL,
  city                  TEXT NOT NULL,
  country               TEXT DEFAULT 'France',
  theme                 TEXT NOT NULL,
  theme_description     TEXT,
  narrative             TEXT,
  product_description   TEXT,
  mode                  TEXT DEFAULT 'city_game',
  target_stop_count     INT DEFAULT 8,

  -- Point de départ (texte OU coords directes)
  start_point_text      TEXT,
  start_point_lat       DOUBLE PRECISION,
  start_point_lon       DOUBLE PRECISION,

  -- Résultat de runSimpleDiscovery (pré-validation)
  stops                 JSONB,
  diagnostics           JSONB,

  -- Lifecycle
  status                TEXT NOT NULL DEFAULT 'pending',
  validated_at          TIMESTAMPTZ,
  fulfilled_at          TIMESTAMPTZ,
  fulfilled_game_id     UUID REFERENCES games(id) ON DELETE SET NULL,

  -- Audit
  validation_error      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS game_drafts_slug_idx ON game_drafts(slug);
CREATE INDEX IF NOT EXISTS game_drafts_status_idx ON game_drafts(status);
CREATE INDEX IF NOT EXISTS game_drafts_city_idx ON game_drafts(city);
