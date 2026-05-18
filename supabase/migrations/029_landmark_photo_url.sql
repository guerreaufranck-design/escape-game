-- Landmark photo per stop.
--
-- Added 2026-05-17 for C3 feature : show the player a real photo of the
-- landmark BEFORE they arrive, so they can recognize the building from
-- afar. Massive UX improvement for unfamiliar cities (the core target
-- audience per project_target_audience.md).
--
-- Source : Google Places "photos" API. Each Places result includes up
-- to 10 photo_references ; we fetch the highest-quality one, store the
-- JPEG in Supabase Storage (bucket `landmark_photos`), and save the
-- public URL here.
--
-- Nullable : not all stops have a Google photo (small chapels, ruins,
-- archaeological sites without dedicated entries). UI hides the photo
-- card if NULL.

ALTER TABLE game_steps
  ADD COLUMN IF NOT EXISTS landmark_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS landmark_photo_credit TEXT;

COMMENT ON COLUMN game_steps.landmark_photo_url IS
  'Public URL of a real photo of the landmark, fetched at generation time from Google Places. NULL if no photo available.';
COMMENT ON COLUMN game_steps.landmark_photo_credit IS
  'Attribution string Google requires (e.g. "Photo by Jean Dupont"). Displayed in tiny text under the photo.';

-- Storage bucket for the photos. Public-read (the URL is shown to
-- players), service-role write (only the pipeline uploads). Idempotent.
INSERT INTO storage.buckets (id, name, public)
VALUES ('landmark_photos', 'landmark_photos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies
DROP POLICY IF EXISTS "public read landmark_photos" ON storage.objects;
CREATE POLICY "public read landmark_photos" ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'landmark_photos');

DROP POLICY IF EXISTS "service_role write landmark_photos" ON storage.objects;
CREATE POLICY "service_role write landmark_photos" ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'landmark_photos');
