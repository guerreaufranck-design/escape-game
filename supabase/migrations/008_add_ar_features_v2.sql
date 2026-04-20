-- ============================================
-- Sprint 2: AR facade text (painted hint) + treasure chest
-- ============================================
-- ar_facade_text: short cryptic phrase "painted" on the monument facade,
--   visible in AR mode when the player is locked on target. Falls back
--   to the step's second hint if null.
-- ar_treasure_reward: optional reward text revealed when the player taps
--   the floating treasure chest in AR mode.

ALTER TABLE game_steps
  ADD COLUMN IF NOT EXISTS ar_facade_text TEXT,
  ADD COLUMN IF NOT EXISTS ar_treasure_reward TEXT;
