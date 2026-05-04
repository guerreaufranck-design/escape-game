-- Add landmark_name to game_steps so the operator-clicked real place
-- name (e.g. "Abbaye Saint-Philibert") is preserved in DB without
-- being exposed to the player. The poetic step.title is what players
-- see; landmark_name is what the pipeline + audit tools use to
-- guarantee GPS precision.
--
-- Why this exists: prior to the GPS-first architecture, Claude wrote
-- both a poetic step.title and (allegedly) verbatim coords. Real-world
-- testing showed coord drifts of 50-2848 m across 11 games. The fix
-- is to invert the flow: the operator clicks the exact spot on a
-- satellite map, names it, and Claude only writes narrative around
-- the locked-in coord + name. This column persists that name so
-- future audits / re-geocoding can verify integrity.
ALTER TABLE game_steps
  ADD COLUMN IF NOT EXISTS landmark_name TEXT;

COMMENT ON COLUMN game_steps.landmark_name IS
  'Real landmark name (e.g. "Abbaye Saint-Philibert"), provided by the '
  'operator clicking on a satellite map at game creation. Used for '
  'audit / re-geocoding only. NOT exposed to players.';
