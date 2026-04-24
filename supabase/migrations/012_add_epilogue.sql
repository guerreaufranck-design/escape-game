-- ============================================
-- Narrative epilogue for the game results page
-- ============================================
-- After the player enters the final code (or gives up), the results page
-- opens with a long-form narrative that reveals the "true story" behind
-- the tour, weaving together all the step anecdotes. This is the player's
-- real reward — learning something true and memorable.

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS epilogue_title JSONB,
  ADD COLUMN IF NOT EXISTS epilogue_text JSONB,
  ADD COLUMN IF NOT EXISTS epilogue_image_url TEXT;

COMMENT ON COLUMN games.epilogue_title IS 'Narrative epilogue title (multilingual JSONB {en, fr, ...}) shown on results page';
COMMENT ON COLUMN games.epilogue_text IS 'Full narrative epilogue (multilingual JSONB). 4-6 paragraphs tying together all step anecdotes into a cohesive historical revelation';
COMMENT ON COLUMN games.epilogue_image_url IS 'Optional image illustrating the epilogue';
