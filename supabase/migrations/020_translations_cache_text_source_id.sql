-- Make translations_cache.source_id a TEXT column.
--
-- Why: the runtime translation pipeline uses synthetic source_ids for
-- per-hint and per-attraction entries — values like
-- "hint-<gameUuid>-<stepNumber>-<idx>" or "<stepUuid>-attraction-<idx>".
-- These are NOT valid UUIDs, so every cache write for hints / attractions
-- failed silently before this migration (the writes were wrapped in
-- void/.catch handlers, masking the type-mismatch error). The result was
-- that every player would re-trigger a Gemini call for these fields on
-- every visit — never cached, always slow.
--
-- TEXT accepts every existing UUID value as-is (UUIDs are valid text)
-- and makes the synthetic keys work, so the cache finally serves the
-- hint/attraction translations the pipeline tries to write.
--
-- This is a non-breaking change: every reader (.eq("source_id", id))
-- continues to work whether `id` is a UUID string or a synthetic key.
ALTER TABLE translations_cache
  ALTER COLUMN source_id TYPE TEXT USING source_id::text;
