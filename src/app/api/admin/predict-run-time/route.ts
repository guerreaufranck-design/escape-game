/**
 * Admin endpoint : GET /api/admin/predict-run-time
 *
 * Returns the predictor's estimate of how long a hypothetical pipeline
 * run will take. Lets operators preview whether a given theme/radius
 * combination will trigger the auto-downgrade BEFORE OddballTrip
 * issues the actual POST /api/games/generate.
 *
 * Query params (all optional, defaults eyeballed) :
 *   theme         : string (default "Walking tour")
 *   radius_km     : number (default 2 for walking, 30 for roadtrip)
 *   transportMode : "walking" | "mixed" | "driving" (default "walking")
 *
 * Example :
 *   GET /api/admin/predict-run-time?theme=Loire+châteaux&radius_km=60&transportMode=mixed
 *
 * Auth : admin user session required (createClient + getUser).
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decideBuildStrategy } from "@/lib/pipeline-predictor";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const theme = sp.get("theme") || "Walking tour";
  const transportMode = sp.get("transportMode") || "walking";
  const isRoadtrip = transportMode === "mixed" || transportMode === "driving";
  const radiusKm = parseFloat(
    sp.get("radius_km") ?? (isRoadtrip ? "30" : "2"),
  );

  const decision = decideBuildStrategy({
    theme,
    radius_km: Number.isFinite(radiusKm) ? radiusKm : 2,
    is_roadtrip: isRoadtrip,
  });

  return NextResponse.json({
    inputs: { theme, radius_km: radiusKm, transportMode },
    prediction: decision.prediction,
    decision: {
      perplexity_model: decision.perplexity_model,
      flag_needs_review: decision.flag_needs_review,
      needs_review_reason: decision.needs_review_reason ?? null,
    },
  });
}
