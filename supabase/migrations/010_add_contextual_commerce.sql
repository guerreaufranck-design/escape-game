-- ============================================
-- Contextual commerce layer (dormant, not integrated yet)
-- ============================================
-- Infrastructure for showing weather/location/time-aware restaurant
-- suggestions during + after tours. Designed to work with Google Places
-- first (free tier), then The Fork affiliate API once approved.
--
-- These tables are ADDITIVE ONLY. They do not modify any existing table,
-- do not affect any existing flow. Migration is safe to apply any time.

-- Track every suggestion that gets shown to players — used for CTR,
-- conversion analytics, and future ML optimization.
CREATE TABLE IF NOT EXISTS suggestion_impressions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID REFERENCES game_sessions(id) ON DELETE CASCADE,
  step_order          SMALLINT,
  stage               TEXT NOT NULL CHECK (stage IN ('mid_tour', 'end_of_tour')),

  -- Context captured at the moment of the suggestion
  player_lat          DOUBLE PRECISION,
  player_lon          DOUBLE PRECISION,
  weather_temp_c      NUMERIC(4,1),
  weather_condition   TEXT,           -- 'clear' | 'rain' | 'snow' | 'cloudy' | 'storm'
  local_time          TIMESTAMPTZ,
  hour_of_day         SMALLINT,
  language            TEXT DEFAULT 'en',

  -- Restaurant recommendation
  provider            TEXT NOT NULL,  -- 'google_places' | 'thefork' | 'tripadvisor'
  restaurant_id       TEXT NOT NULL,
  restaurant_name     TEXT,
  restaurant_cuisine  TEXT,
  restaurant_rating   NUMERIC(3,2),
  distance_meters     INTEGER,
  discount_percent    SMALLINT,
  booking_url         TEXT,

  -- Generated message shown to player
  message_text        TEXT,

  -- User actions
  clicked             BOOLEAN DEFAULT FALSE,
  clicked_at          TIMESTAMPTZ,
  dismissed           BOOLEAN DEFAULT FALSE,
  dismissed_at        TIMESTAMPTZ,
  booking_confirmed   BOOLEAN DEFAULT FALSE,
  booking_confirmed_at TIMESTAMPTZ,
  commission_amount   NUMERIC(6,2),

  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suggestion_impressions_session ON suggestion_impressions(session_id);
CREATE INDEX IF NOT EXISTS idx_suggestion_impressions_provider ON suggestion_impressions(provider);
CREATE INDEX IF NOT EXISTS idx_suggestion_impressions_created_at ON suggestion_impressions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suggestion_impressions_clicked ON suggestion_impressions(clicked) WHERE clicked = TRUE;

-- Cache of restaurant lookups — reduces API calls and speeds up suggestions.
-- Key is a hash of (lat, lon, radius, provider) rounded to nearest 50m grid.
CREATE TABLE IF NOT EXISTS partner_restaurants_cache (
  cache_key           TEXT PRIMARY KEY,
  provider            TEXT NOT NULL,
  lat_rounded         NUMERIC(8,5) NOT NULL,
  lon_rounded         NUMERIC(8,5) NOT NULL,
  radius_meters       INTEGER NOT NULL,
  restaurants         JSONB NOT NULL DEFAULT '[]',
  created_at          TIMESTAMPTZ DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_partner_restaurants_cache_expires ON partner_restaurants_cache(expires_at);

-- Comment for future devs
COMMENT ON TABLE suggestion_impressions IS 'Analytics table for contextual commerce suggestions. Each row = one suggestion shown. Tracks CTR, conversion, commission.';
COMMENT ON TABLE partner_restaurants_cache IS 'Cache to reduce Google Places / The Fork API calls. Keyed by geo grid + provider. TTL via expires_at.';
