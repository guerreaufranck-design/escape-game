-- 033_drop_ar_historical_photo.sql
--
-- Drop the AR historical photo columns from game_steps.
--
-- Introduced in 007_add_ar_features.sql as an optional Wikipedia/archives
-- overlay shown in the AR camera. We removed it from the product on
-- 2026-05-21: it competed visually with the AR character sprite, required
-- credit/attribution maintenance, and Gemini almost never returned a
-- usable URL in practice (all production rows are NULL).
--
-- Removing the columns now to avoid friction:
--   * pipeline no longer sets them
--   * session route no longer reads them
--   * ARCameraOverlay no longer accepts the props
--   * GameState type no longer declares the field
--
-- Safe to drop: confirmed via SQL that every game_steps row has
-- ar_historical_photo_url = NULL.

ALTER TABLE game_steps
  DROP COLUMN IF EXISTS ar_historical_photo_url,
  DROP COLUMN IF EXISTS ar_historical_photo_credit;
