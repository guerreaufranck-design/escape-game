/**
 * Google Places (New) adapter.
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/nearby-search
 * Uses the NEW Places API (post-2024) with field masks for cost optimization.
 *
 * Free tier: $200/month credit is typically enough for thousands of requests.
 * Cost per 1k calls with our field mask: ~$32 USD.
 */

import type { Restaurant, SearchParams } from "./types";

interface GooglePlacesResponse {
  places?: Array<{
    id: string;
    displayName?: { text: string };
    rating?: number;
    userRatingCount?: number;
    priceLevel?: string; // PRICE_LEVEL_INEXPENSIVE, etc
    googleMapsUri?: string;
    websiteUri?: string;
    primaryType?: string;
    primaryTypeDisplayName?: { text: string };
    location?: { latitude: number; longitude: number };
    formattedAddress?: string;
    currentOpeningHours?: { openNow?: boolean };
  }>;
}

function priceLevelToNumber(level?: string): number | null {
  switch (level) {
    case "PRICE_LEVEL_FREE": return 0;
    case "PRICE_LEVEL_INEXPENSIVE": return 1;
    case "PRICE_LEVEL_MODERATE": return 2;
    case "PRICE_LEVEL_EXPENSIVE": return 3;
    case "PRICE_LEVEL_VERY_EXPENSIVE": return 4;
    default: return null;
  }
}

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/**
 * Search nearby restaurants via Google Places API (New).
 * Returns [] on any failure (including missing API key) — never throws.
 */
export async function searchGooglePlaces(
  params: SearchParams,
): Promise<Restaurant[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.warn("[google-places] GOOGLE_PLACES_API_KEY not configured");
    return [];
  }

  const minRating = params.minRating ?? 4.0;
  const maxResults = Math.min(params.maxResults ?? 10, 20); // API max 20

  try {
    const res = await fetch(
      "https://places.googleapis.com/v1/places:searchNearby",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": [
            "places.id",
            "places.displayName",
            "places.rating",
            "places.userRatingCount",
            "places.priceLevel",
            "places.googleMapsUri",
            "places.websiteUri",
            "places.primaryType",
            "places.primaryTypeDisplayName",
            "places.location",
            "places.formattedAddress",
            "places.currentOpeningHours",
          ].join(","),
        },
        body: JSON.stringify({
          includedTypes: ["restaurant"],
          maxResultCount: maxResults,
          locationRestriction: {
            circle: {
              center: { latitude: params.lat, longitude: params.lon },
              radius: Math.min(params.radiusMeters, 500),
            },
          },
        }),
        signal: AbortSignal.timeout(8000),
      },
    );

    if (!res.ok) {
      console.warn(
        `[google-places] API returned ${res.status}: ${await res.text().catch(() => "")}`,
      );
      return [];
    }

    const data = (await res.json()) as GooglePlacesResponse;
    if (!data.places) return [];

    return data.places
      .filter((p) => (p.rating ?? 0) >= minRating)
      .filter((p) => !params.openNow || p.currentOpeningHours?.openNow !== false)
      .map<Restaurant>((p) => {
        const lat = p.location?.latitude ?? params.lat;
        const lon = p.location?.longitude ?? params.lon;
        return {
          id: p.id,
          name: p.displayName?.text ?? "Restaurant",
          cuisine: p.primaryTypeDisplayName?.text ?? null,
          rating: p.rating ?? 0,
          reviewCount: p.userRatingCount,
          priceLevel: priceLevelToNumber(p.priceLevel),
          distanceMeters: haversineDistance(params.lat, params.lon, lat, lon),
          bookingUrl: p.googleMapsUri ?? p.websiteUri ?? "",
          discountPercent: 0, // Google doesn't offer partner discounts
          latitude: lat,
          longitude: lon,
          address: p.formattedAddress ?? null,
          provider: "google_places",
        };
      })
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  } catch (err) {
    console.warn(
      "[google-places] Request failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
