/**
 * Landmark photo fetching via Google Places API + Supabase Storage.
 *
 * Flow per stop :
 *   1. Use the place_id (or name + city if no place_id stored) to call
 *      Google Place Details API with `fields=photos`.
 *   2. Grab the first photo_reference (highest-quality usually).
 *   3. Call Google Place Photo API to download the JPEG.
 *   4. Upload to Supabase Storage bucket `landmark_photos/{gameId}/step{N}.jpg`.
 *   5. Return the public URL + attribution string.
 *
 * Cost : 1 Place Details ($0.017) + 1 Place Photo ($0.007) per stop.
 * For 8 stops × $0.024 ≈ $0.19 per game. Acceptable for the UX win.
 *
 * Failure mode : if Google has no photo for the POI, returns null silently.
 * The pipeline stores NULL in landmark_photo_url and the UI hides the
 * photo card. Player still sees the riddle + AR scan.
 */

import { createAdminClient } from "@/lib/supabase/admin";

const REQUEST_TIMEOUT_MS = 15_000;
/** Max width pixels requested from Google Photos API. 1200 covers all
 *  reasonable phone screens with retina density. */
const PHOTO_MAX_WIDTH = 1200;

export interface LandmarkPhotoResult {
  publicUrl: string;
  attribution: string;
}

/**
 * Find a photo_reference + attribution for a named landmark.
 * Returns null if the landmark has no photo in Google's database.
 */
async function findPhotoReference(
  landmarkName: string,
  city: string,
  country: string,
): Promise<{ photoReference: string; attribution: string } | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  // 1. Find the place_id via findplacefromtext.
  const query = [landmarkName, city, country].filter(Boolean).join(", ");
  const findUrl = new URL(
    "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
  );
  findUrl.searchParams.set("input", query);
  findUrl.searchParams.set("inputtype", "textquery");
  findUrl.searchParams.set("fields", "place_id");
  findUrl.searchParams.set("key", apiKey);

  const ac1 = new AbortController();
  const t1 = setTimeout(() => ac1.abort(), REQUEST_TIMEOUT_MS);
  let placeId: string | null = null;
  try {
    const res = await fetch(findUrl.toString(), { signal: ac1.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status: string;
      candidates?: Array<{ place_id?: string }>;
    };
    placeId = data.candidates?.[0]?.place_id ?? null;
  } finally {
    clearTimeout(t1);
  }
  if (!placeId) return null;

  // 2. Place Details with `photos` field.
  const detailsUrl = new URL(
    "https://maps.googleapis.com/maps/api/place/details/json",
  );
  detailsUrl.searchParams.set("place_id", placeId);
  detailsUrl.searchParams.set("fields", "photos");
  detailsUrl.searchParams.set("key", apiKey);

  const ac2 = new AbortController();
  const t2 = setTimeout(() => ac2.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(detailsUrl.toString(), { signal: ac2.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status: string;
      result?: {
        photos?: Array<{
          photo_reference: string;
          html_attributions?: string[];
        }>;
      };
    };
    const photo = data.result?.photos?.[0];
    if (!photo?.photo_reference) return null;
    // Strip HTML tags from attribution (Google returns them with <a> wrappers).
    const rawAttr = photo.html_attributions?.[0] ?? "";
    const cleanAttr = rawAttr.replace(/<[^>]+>/g, "").trim();
    return {
      photoReference: photo.photo_reference,
      attribution: cleanAttr || "Photo via Google",
    };
  } finally {
    clearTimeout(t2);
  }
}

/**
 * Downloads the Google Photo bytes for a given photo_reference.
 * Returns the JPEG as a Buffer (typed as Uint8Array for cross-runtime
 * compat — Edge runtime does not have node Buffer).
 */
async function downloadPhotoBytes(
  photoReference: string,
): Promise<Uint8Array | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/photo",
  );
  url.searchParams.set("photo_reference", photoReference);
  url.searchParams.set("maxwidth", String(PHOTO_MAX_WIDTH));
  url.searchParams.set("key", apiKey);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: ac.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return new Uint8Array(arrayBuf);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * High-level helper called by the generation pipeline. Fetches a photo,
 * uploads to Storage, returns the public URL.
 * Returns null if any step fails (no photo available, Google quota,
 * Storage error, etc.) — the pipeline continues without a photo.
 */
export async function fetchAndStoreLandmarkPhoto(params: {
  gameId: string;
  stepOrder: number;
  landmarkName: string;
  city: string;
  country: string;
}): Promise<LandmarkPhotoResult | null> {
  const { gameId, stepOrder, landmarkName, city, country } = params;
  try {
    const ref = await findPhotoReference(landmarkName, city, country);
    if (!ref) return null;

    const bytes = await downloadPhotoBytes(ref.photoReference);
    if (!bytes || bytes.length < 1024) {
      // < 1 KB = almost certainly an error response, not a real photo
      return null;
    }

    const supabase = createAdminClient();
    const path = `${gameId}/step${stepOrder}.jpg`;
    const { error: uploadErr } = await supabase.storage
      .from("landmark_photos")
      .upload(path, bytes, {
        contentType: "image/jpeg",
        cacheControl: "31536000", // 1 year
        upsert: true,
      });
    if (uploadErr) {
      console.warn(
        `[landmark-photos] upload failed for game ${gameId} step ${stepOrder}: ${uploadErr.message}`,
      );
      return null;
    }

    const { data: pub } = supabase.storage
      .from("landmark_photos")
      .getPublicUrl(path);
    if (!pub.publicUrl) return null;

    return {
      publicUrl: pub.publicUrl,
      attribution: ref.attribution,
    };
  } catch (err) {
    console.warn(
      `[landmark-photos] failed for game ${params.gameId} step ${params.stepOrder} "${params.landmarkName}": ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}
