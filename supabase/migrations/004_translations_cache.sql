-- Translations cache for game content (steps, hints, etc.)
CREATE TABLE IF NOT EXISTS translations_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  source_field TEXT NOT NULL,
  language TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_id, source_field, language)
);

CREATE INDEX IF NOT EXISTS idx_translations_cache_lookup ON translations_cache(source_id, source_field, language);

-- UI string translations cache
CREATE TABLE IF NOT EXISTS ui_translations_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  translation_key TEXT NOT NULL,
  language TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(translation_key, language)
);
