-- Allow 'riddle' as a slot for audio_cache. Riddles are the longest
-- voiceable text and the FIRST thing the player hears on each step,
-- so playing it through Web Speech (browser TTS, robot voice) breaks
-- the ElevenLabs immersion the customer paid for. Add the slot here
-- so the orchestrator can store the riddle MP3 alongside character +
-- anecdote + epilogue.

ALTER TABLE audio_cache DROP CONSTRAINT IF EXISTS audio_cache_slot_check;
ALTER TABLE audio_cache
  ADD CONSTRAINT audio_cache_slot_check
  CHECK (slot IN ('character', 'anecdote', 'epilogue', 'riddle'));
