-- Migration: Add multilingual support
-- Convert text fields to JSONB for i18n (fr, en, de, es, it)

-- Games table
ALTER TABLE games ALTER COLUMN title TYPE JSONB USING jsonb_build_object('fr', title);
ALTER TABLE games ALTER COLUMN description TYPE JSONB USING CASE WHEN description IS NOT NULL THEN jsonb_build_object('fr', description) ELSE NULL END;

-- Game steps table
ALTER TABLE game_steps ALTER COLUMN title TYPE JSONB USING jsonb_build_object('fr', title);
ALTER TABLE game_steps ALTER COLUMN riddle_text TYPE JSONB USING jsonb_build_object('fr', riddle_text);
ALTER TABLE game_steps ALTER COLUMN answer_text TYPE JSONB USING CASE WHEN answer_text IS NOT NULL THEN jsonb_build_object('fr', answer_text) ELSE NULL END;

-- Note: hints column is already JSONB but hint text values should follow the same pattern
-- hints: [{"order": 1, "text": {"fr": "...", "en": "..."}, "image": "..."}]

-- Helper function to extract localized text with fallback
CREATE OR REPLACE FUNCTION t(val JSONB, locale TEXT DEFAULT 'fr')
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(val ->> locale, val ->> 'fr', val ->> 'en');
$$;
