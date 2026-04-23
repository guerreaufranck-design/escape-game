/**
 * TEST-ONLY endpoint — validates the full contextual suggestion stack:
 * 1. Open-Meteo weather call
 * 2. Google Places restaurant search
 * 3. Gemini message generation
 *
 * Usage:
 *   GET /api/test-suggestion?lat=48.8566&lon=2.3522&city=Paris&stage=end_of_tour&lang=fr
 *
 * Protected: requires EXTERNAL_API_SECRET Bearer token (same as other
 * internal endpoints) so only the admin can hit it.
 *
 * DORMANT: not linked from the UI. Safe to leave in prod.
 */

import { NextRequest, NextResponse } from "next/server";
import { getContextSnapshot } from "@/lib/context-engine";
import { searchRestaurants } from "@/lib/restaurant-search";
import { generateSuggestion } from "@/lib/suggestion-generator";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  // Simple auth to prevent public abuse
  const authHeader = request.headers.get("authorization");
  const expected = process.env.EXTERNAL_API_SECRET;
  if (!authHeader || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get("lat") || "48.8566");
  const lon = parseFloat(searchParams.get("lon") || "2.3522");
  const city = searchParams.get("city") || "Paris";
  const stage = (searchParams.get("stage") || "mid_tour") as
    | "mid_tour"
    | "end_of_tour";
  const language = searchParams.get("lang") || "fr";

  // Env diagnostic — helps understand why a provider might return empty.
  // Never leak actual values. Only presence + length (rough integrity check).
  const envDiag = {
    GOOGLE_PLACES_API_KEY: {
      present: !!process.env.GOOGLE_PLACES_API_KEY,
      length: process.env.GOOGLE_PLACES_API_KEY?.length || 0,
      prefix: process.env.GOOGLE_PLACES_API_KEY?.substring(0, 4) || null,
    },
    GEMINI_API_KEY: { present: !!process.env.GEMINI_API_KEY },
    THEFORK_PARTNER_ID: { present: !!process.env.THEFORK_PARTNER_ID },
    THEFORK_API_KEY: { present: !!process.env.THEFORK_API_KEY },
  };

  // DEBUG mode: call Google Places directly and return raw response
  if (searchParams.get("debug") === "1") {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "No Google key", envDiag }, { status: 500 });
    }
    try {
      const debugRes = await fetch(
        "https://places.googleapis.com/v1/places:searchNearby",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "places.id,places.displayName,places.rating,places.formattedAddress",
          },
          body: JSON.stringify({
            includedTypes: ["restaurant"],
            maxResultCount: 5,
            locationRestriction: {
              circle: { center: { latitude: lat, longitude: lon }, radius: 500 },
            },
          }),
        },
      );
      const debugBody = await debugRes.text();
      return NextResponse.json({
        envDiag,
        debug: {
          status: debugRes.status,
          statusText: debugRes.statusText,
          body: debugBody.substring(0, 2000),
        },
      });
    } catch (e) {
      return NextResponse.json({
        envDiag,
        debugError: e instanceof Error ? e.message : String(e),
      });
    }
  }

  try {
    console.log(`[test-suggestion] Stage=${stage} at (${lat},${lon}) in ${city}`);

    // 1. Context
    const t0 = Date.now();
    const context = await getContextSnapshot({ lat, lon, city, language, stage });
    const contextMs = Date.now() - t0;

    // 2. Restaurants (wider radius for end-of-tour)
    const t1 = Date.now();
    const restaurants = await searchRestaurants({
      lat,
      lon,
      radiusMeters: stage === "end_of_tour" ? 2000 : 200,
      minRating: 4.0,
      maxResults: 10,
      openNow: stage === "mid_tour",
    });
    const searchMs = Date.now() - t1;

    // 3. Suggestion message
    const t2 = Date.now();
    const suggestion = await generateSuggestion(context, restaurants);
    const genMs = Date.now() - t2;

    return NextResponse.json({
      ok: true,
      timings: {
        contextMs,
        searchMs,
        genMs,
        totalMs: contextMs + searchMs + genMs,
      },
      context,
      restaurantCount: restaurants.length,
      restaurants: restaurants.slice(0, 5),
      suggestion,
    });
  } catch (err) {
    console.error("[test-suggestion] Error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
