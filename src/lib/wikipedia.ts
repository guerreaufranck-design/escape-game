/**
 * Wikipedia Commons helper — finds a public-domain photo/illustration
 * for a location (monument, square, church…) and returns its URL + credit.
 *
 * Used by the game generation pipeline to populate the AR historical-photo
 * overlay on each step. The photo is shown semi-transparent over the live
 * camera feed (sepia filter applied client-side) to give a "time travel" feel.
 *
 * No API key needed. The Wikipedia API is CORS-enabled and free.
 */

interface WikiSearchResult {
  query?: {
    search?: { title: string; snippet: string }[];
  };
}

interface WikiPageImageResult {
  query?: {
    pages?: Record<
      string,
      {
        title: string;
        thumbnail?: { source: string; width: number; height: number };
        pageimage?: string;
      }
    >;
  };
}

interface WikiImageInfoResult {
  query?: {
    pages?: Record<
      string,
      {
        imageinfo?: {
          url: string;
          extmetadata?: {
            Artist?: { value: string };
            DateTimeOriginal?: { value: string };
            LicenseShortName?: { value: string };
          };
        }[];
      }
    >;
  };
}

/** Strip HTML tags from a Wikipedia snippet */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

/**
 * Find the best Wikipedia page for a given monument + city.
 * Returns the exact page title or null.
 */
async function findBestPage(name: string, city: string): Promise<string | null> {
  try {
    // Search with both name and city for disambiguation
    const query = encodeURIComponent(`${name} ${city}`);
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${query}&srlimit=3&format=json&origin=*`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as WikiSearchResult;
    const hits = data.query?.search || [];
    if (hits.length === 0) return null;
    // Prefer the hit whose title best matches the name
    const nameLower = name.toLowerCase();
    const best =
      hits.find((h) => h.title.toLowerCase().includes(nameLower)) || hits[0];
    return best.title;
  } catch {
    return null;
  }
}

/**
 * Get the Commons image filename from a Wikipedia page.
 * Uses the "pageimage" (the lead infobox image) which is usually the most iconic.
 */
async function getPageImage(title: string): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(title);
    const url = `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&titles=${encoded}&pithumbsize=1400&format=json&origin=*`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as WikiPageImageResult;
    const pages = data.query?.pages;
    if (!pages) return null;
    const firstPage = Object.values(pages)[0];
    return firstPage?.thumbnail?.source || null;
  } catch {
    return null;
  }
}

/**
 * Get Commons metadata (author, license) for a given image filename.
 * Used to build the attribution badge.
 */
async function getImageCredit(imageUrl: string): Promise<string | null> {
  try {
    // Extract the filename from the Commons URL
    const match = imageUrl.match(/\/([^/]+\.(?:jpg|jpeg|png|svg|webp))/i);
    if (!match) return null;
    const filename = decodeURIComponent(match[1]);
    const encoded = encodeURIComponent(`File:${filename}`);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encoded}&prop=imageinfo&iiprop=extmetadata&format=json&origin=*`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as WikiImageInfoResult;
    const pages = data.query?.pages;
    if (!pages) return null;
    const firstPage = Object.values(pages)[0];
    const meta = firstPage?.imageinfo?.[0]?.extmetadata;
    const artist = meta?.Artist?.value ? stripHtml(meta.Artist.value) : null;
    const license = meta?.LicenseShortName?.value || null;
    const date = meta?.DateTimeOriginal?.value
      ? stripHtml(meta.DateTimeOriginal.value).slice(0, 10)
      : null;

    const parts: string[] = [];
    if (artist) parts.push(artist);
    if (date) parts.push(date);
    parts.push("Wikimedia Commons");
    if (license) parts.push(license);
    return parts.join(" · ");
  } catch {
    return null;
  }
}

export interface HistoricalPhotoResult {
  url: string;
  credit: string | null;
}

/**
 * Main entry point: find a Wikipedia photo for a location.
 * Returns null if nothing found (the AR layer just won't show).
 */
export async function fetchHistoricalPhoto(
  locationName: string,
  city: string,
): Promise<HistoricalPhotoResult | null> {
  try {
    const pageTitle = await findBestPage(locationName, city);
    if (!pageTitle) {
      console.log(`[Wikipedia] No page found for "${locationName}" in ${city}`);
      return null;
    }

    const photoUrl = await getPageImage(pageTitle);
    if (!photoUrl) {
      console.log(`[Wikipedia] Page "${pageTitle}" has no image`);
      return null;
    }

    const credit = await getImageCredit(photoUrl);

    console.log(`[Wikipedia] ✓ "${locationName}" → ${pageTitle}`);
    return { url: photoUrl, credit };
  } catch (err) {
    console.warn(
      `[Wikipedia] Fetch failed for "${locationName}": ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}
