-- ============================================
-- Virtual AR answers — unblock pipeline when physical indices don't exist
-- ============================================
-- Some stops don't have a convenient observable (year engraved, name on plaque).
-- Rather than failing the whole game generation, we now generate a virtual
-- answer that appears as a magical AR overlay when the player points their
-- phone at the target (GPS validated + AR locked-on).
--
-- Value: 'physical' (current behaviour — find real engraved year/name/count)
--        'virtual_ar' (answer materialises in AR; no real physical indice)

ALTER TABLE game_steps
  ADD COLUMN IF NOT EXISTS answer_source TEXT
  DEFAULT 'physical'
  CHECK (answer_source IN ('physical', 'virtual_ar'));

-- Existing rows are implicitly 'physical' via DEFAULT.

COMMENT ON COLUMN game_steps.answer_source IS
  'physical = real inscription/number on the monument; virtual_ar = AR-generated answer painted on the wall when player locks on target';
