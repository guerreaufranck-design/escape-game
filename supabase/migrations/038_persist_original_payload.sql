-- 038_persist_original_payload.sql
--
-- Persist the original POST /api/games/generate body in the games table.
--
-- ════════════════════════════════════════════════════════════════════
-- Motivation — POST-INCIDENT 22/05/2026
-- ════════════════════════════════════════════════════════════════════
--
-- The 22/05 Aigues-Mortes incident produced a game with 7 thematically
-- wrong stops (aquariums + Montpellier museums). Root-cause analysis
-- could not reconstruct what OddballTrip had ACTUALLY sent in the
-- payload — we only had the OUTPUT (Claude-generated title, description,
-- stops). Without the original briefing, debugging "what did the
-- operator actually intend ?" became guesswork.
--
-- This migration adds `original_payload JSONB` to `games`. The pipeline
-- will populate it at INSERT time with the verbatim POST body from
-- OddballTrip. Future incidents are then debuggable in 10 seconds.
--
-- ════════════════════════════════════════════════════════════════════
-- Privacy & PII
-- ════════════════════════════════════════════════════════════════════
--
-- The payload may contain buyerEmail, orderId, callbackSecret. We
-- intentionally store these because :
--   - buyerEmail : already in activation_codes.buyer_email, no new PII
--   - orderId : already in our system
--   - callbackSecret : sensitive but already in our env at runtime
-- RLS already restricts games table to admins — no extra exposure.
--
-- We do NOT store the Authorization header (Bearer token) — the route
-- handler strips it before passing to the pipeline.

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS original_payload JSONB;

COMMENT ON COLUMN games.original_payload IS
  'Verbatim POST body received from OddballTrip at /api/games/generate. Stored for post-incident root-cause analysis (cf. 22/05/2026 Aigues-Mortes case). NULL for games created pre-migration. Authorization header is NOT included.';

-- No index needed — column is for debugging not for query.
