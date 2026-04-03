-- Add slug column to games for exact matching from oddballtrip
ALTER TABLE games ADD COLUMN IF NOT EXISTS slug TEXT;

-- Index for fast slug lookups
CREATE INDEX IF NOT EXISTS idx_games_slug ON games(slug);
