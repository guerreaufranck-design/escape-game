/**
 * The Fork affiliate API adapter — STUB (waiting for partner approval).
 *
 * Once Kwanko + TheFork validate our partner registration, this adapter
 * will be fully implemented. For now, returns empty array so the search
 * cascade falls back to Google Places.
 *
 * Expected env vars once activated:
 *   THEFORK_PARTNER_ID   — provided by Kwanko after registration
 *   THEFORK_API_KEY      — provided by TheFork partner portal
 */

import type { Restaurant, SearchParams } from "./types";

/** When activated, replace the function body with a real Fork API call. */
export async function searchTheFork(
  _params: SearchParams,
): Promise<Restaurant[]> {
  const partnerId = process.env.THEFORK_PARTNER_ID;
  const apiKey = process.env.THEFORK_API_KEY;

  if (!partnerId || !apiKey) {
    // Not configured yet — silently return empty so cascade falls back
    return [];
  }

  // TODO: implement real Fork API call once approved.
  // Expected endpoint: https://api.thefork.com/v1/restaurants/search
  // Example implementation:
  //
  // const res = await fetch(
  //   `https://api.thefork.com/v1/restaurants/search?lat=${_params.lat}&lng=${_params.lon}&radius=${_params.radiusMeters}&minRating=${_params.minRating ?? 4.0}`,
  //   {
  //     headers: {
  //       "X-Partner-Id": partnerId,
  //       Authorization: `Bearer ${apiKey}`,
  //     },
  //     signal: AbortSignal.timeout(8000),
  //   }
  // );
  // ...map to Restaurant[] with commission_url = `${r.url}?partnerId=${partnerId}`
  //
  // The exact endpoint + payload shape will be confirmed by TheFork
  // onboarding doc once we're approved.

  return [];
}
