-- ============================================
-- Sprint 3: AR character speaker
-- ============================================
-- ar_character_type: visual style of the animated character that appears
--   when the player is locked on target. Values: 'monk', 'knight', 'pirate',
--   'wizard', 'scholar', 'merchant' (NULL disables the character).
-- ar_character_dialogue: short speech-bubble text the character delivers.
--   Falls back to hint #1 (atmospheric) if null, to avoid spoiling the answer.

ALTER TABLE game_steps
  ADD COLUMN IF NOT EXISTS ar_character_type TEXT,
  ADD COLUMN IF NOT EXISTS ar_character_dialogue TEXT;
