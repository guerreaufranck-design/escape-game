-- ============================================
-- Sprint 1: AR features on game_steps
-- ============================================
-- ar_historical_photo_url: URL to a historical photo/engraving
--   of the location, shown as a semi-transparent overlay in AR mode.
-- ar_historical_photo_credit: attribution text (e.g. "Wikipedia Commons — author, year")

ALTER TABLE game_steps
  ADD COLUMN IF NOT EXISTS ar_historical_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS ar_historical_photo_credit TEXT;
