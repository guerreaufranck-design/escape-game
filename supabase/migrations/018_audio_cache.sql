-- Audio cache for ElevenLabs-generated narration MP3s.
--
-- One row per (game × step × language × slot). The audio file itself
-- lives in the Supabase Storage bucket 'audio'; this table holds the
-- public URL + metadata for fast lookup at play time.
--
-- Slot is one of:
--   'character'  -- AR character dialogue (whisper of the knight/witch/...)
--   'anecdote'   -- historical anecdote shown after step validation
--   'epilogue'   -- final narrative played on game completion (step 0 by convention)
--
-- The bucket is configured public-read so the player <audio> tag can
-- load directly without Supabase Storage auth. Writes are restricted
-- to service_role (the API route uses createAdminClient).

CREATE TABLE IF NOT EXISTS audio_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  step_order int NOT NULL,
  language text NOT NULL,
  slot text NOT NULL CHECK (slot IN ('character', 'anecdote', 'epilogue')),
  storage_path text NOT NULL,
  public_url text NOT NULL,
  byte_size int,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, step_order, language, slot)
);

CREATE INDEX IF NOT EXISTS idx_audio_cache_lookup
  ON audio_cache (game_id, language);

ALTER TABLE audio_cache ENABLE ROW LEVEL SECURITY;

-- Public read so the <audio> player can fetch without auth
CREATE POLICY "audio_cache_public_read"
  ON audio_cache FOR SELECT
  USING (true);

-- Storage bucket setup is done manually via Supabase dashboard:
--   1. Create bucket "audio" with public access enabled
--   2. Policy: anyone can SELECT (read)
--   3. Policy: service_role can INSERT/UPDATE/DELETE
-- (Storage policies cannot be created via SQL migration on hosted Supabase.)
