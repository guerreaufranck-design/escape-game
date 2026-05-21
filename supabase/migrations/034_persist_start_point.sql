-- 034_persist_start_point.sql
--
-- Persist the resolved startPoint of each game in the `games` table.
--
-- WHY
-- ────
-- The pipeline receives `start_point_text`, `start_point_lat`,
-- `start_point_lon` in the OddballTrip POST body, resolves them against
-- the Google Geocoding API + Top-Landmark heuristic (cf. game-pipeline.ts
-- STEP 0), and uses the RESOLVED coords downstream for discovery, bias,
-- and validation.
--
-- BUT we never STORED the resolved value. So post-facto inspections
-- can't tell where a published game actually starts. Debug situations
-- like 2026-05-21 (slug `l-itineraire-code-de-vinci`) where Step 1 was
-- 14 km off the real landmark required guessing the startPoint from
-- runtime logs.
--
-- WHAT THESE COLUMNS HOLD
-- ────────────────────────
-- start_point_text   : The human-readable label resolved (e.g. "Château
--                      de Chambord, France"). Same as what OddballTrip
--                      sent, OR the auto-resolved top-landmark label
--                      if OddballTrip omitted it.
-- start_point_lat    : The GPS latitude of the resolved start point
--                      (Google Places sub-10m precision when available).
-- start_point_lon    : The GPS longitude.
-- start_point_source : Audit trail of which resolution strategy won.
--                      One of:
--                       - "body-text-geocoded"   : OddballTrip's
--                         `start_point_text` resolved successfully.
--                       - "top-landmark-google"  : Pipeline derived
--                         the top landmark of the city when no text was
--                         provided.
--                       - "city-center-fallback" : Last-resort city
--                         centroid (lowest precision).
--                       - "body-coords-trusted"  : Pipeline trusted the
--                         coords in the body directly (deprecated path).
--
-- USAGE
-- ─────
-- * Admin/audit views can read these to display "Game starts at
--   {start_point_text} ({lat},{lon})".
-- * Player app's intro screen can show the meeting point coords directly
--   instead of re-deriving them.
-- * Pipeline-validators can compare each stop's distance from the resolved
--   start_point — useful to detect the NARRATIVE_OFFSET fallback bug
--   ("if step 1 is exactly 350m from start_point, geocode probably failed").
--
-- NULL TOLERATED
-- ───────────────
-- Existing rows pre-2026-05-21 won't have these populated. We don't
-- backfill (pipeline didn't log them) — just allow NULL. New pipeline
-- runs after deployment populate these fields.

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS start_point_text TEXT,
  ADD COLUMN IF NOT EXISTS start_point_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS start_point_lon DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS start_point_source TEXT;

COMMENT ON COLUMN games.start_point_text   IS 'Human-readable label of the resolved meeting point (e.g. "Château de Chambord, France"). Filled at pipeline INSERT time. NULL for legacy rows pre-2026-05-21.';
COMMENT ON COLUMN games.start_point_lat    IS 'GPS latitude of the resolved meeting point, sub-10m precision when Google Places resolved it. NULL for legacy rows.';
COMMENT ON COLUMN games.start_point_lon    IS 'GPS longitude of the resolved meeting point. NULL for legacy rows.';
COMMENT ON COLUMN games.start_point_source IS 'Which resolution strategy produced the start point: body-text-geocoded | top-landmark-google | city-center-fallback | body-coords-trusted. Useful for debugging precision issues.';
