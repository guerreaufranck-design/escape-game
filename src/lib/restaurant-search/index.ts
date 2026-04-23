/**
 * Restaurant search — provider cascade with graceful fallback.
 *
 * Order: The Fork (best, with commission) → Google Places (fallback).
 * Any provider failure or empty result falls through to the next.
 * Final empty array means "no suggestion to show" — the UI shows nothing.
 */

import type { Restaurant, SearchParams } from "./types";
import { searchTheFork } from "./thefork";
import { searchGooglePlaces } from "./google-places";

export type { Restaurant, SearchParams } from "./types";

/**
 * Search restaurants near a location.
 * Never throws — returns empty array on total failure.
 */
export async function searchRestaurants(
  params: SearchParams,
): Promise<Restaurant[]> {
  // 1. Try The Fork first (partner discounts + commissions)
  const forkResults = await searchTheFork(params);
  if (forkResults.length > 0) {
    console.log(`[restaurant-search] Fork returned ${forkResults.length} results`);
    return forkResults;
  }

  // 2. Fallback to Google Places (no commission, richer data)
  const googleResults = await searchGooglePlaces(params);
  if (googleResults.length > 0) {
    console.log(`[restaurant-search] Google Places returned ${googleResults.length} results`);
    return googleResults;
  }

  // 3. Nothing found — the UI will show no suggestion
  console.log("[restaurant-search] No results from any provider");
  return [];
}
