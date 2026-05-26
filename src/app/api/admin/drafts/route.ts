/**
 * POST /api/admin/drafts
 *
 * Crée 1 ou plusieurs drafts et lance la pré-validation runSimpleDiscovery()
 * pour chacun. La pré-val coûte ~$0.95/jeu (Perplexity + Google Places) et
 * prend ~7-10 min par jeu. À étaler côté caller (batches de 5-10).
 *
 * Body (single OU array) :
 *   {
 *     "drafts": [
 *       {
 *         "slug": "le-secret-roi-louis-xv-versailles",
 *         "city": "Versailles",
 *         "country": "France",
 *         "theme": "Le Secret du Roi Louis XV",
 *         "themeDescription": "...",
 *         "productDescription": "...",       // optionnel
 *         "narrative": "...",                 // optionnel
 *         "startPointText": "Place d'Armes, Versailles",  // OU lat+lon
 *         "startPointLat": 48.8049,
 *         "startPointLon": 2.1204,
 *         "mode": "city_game",                // OU "city_tour"
 *         "targetStopCount": 8                // optionnel, default 8
 *       },
 *       ...
 *     ],
 *     "runValidationNow": true               // si false, juste insert pending
 *   }
 *
 * Auth : admin session OR EXTERNAL_API_SECRET Bearer.
 *
 * GET /api/admin/drafts → liste tous les drafts.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { validateApiKey } from "@/lib/external-auth";
import { inngest } from "@/lib/inngest-client";

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (validateApiKey(request)) return true;
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const admin = createAdminClient();
    const { data: adminRow } = await admin
      .from("admin_users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    return Boolean(adminRow);
  } catch {
    return false;
  }
}

export const dynamic = "force-dynamic";
// V2 (2026-05-24) — l'endpoint enqueue maintenant un event Inngest et
// return immédiatement (~1s). Plus de besoin de maxDuration long.

interface DraftInput {
  slug?: string;
  city?: string;
  country?: string;
  theme?: string;
  themeDescription?: string;
  productDescription?: string;
  narrative?: string;
  startPointText?: string;
  startPointLat?: number;
  startPointLon?: number;
  mode?: string;
  targetStopCount?: number;
  // (2026-05-24) For mixed/driving roadtrip games, walking_radius must
  // be widened (30 km vs 1.75 km default). The pipeline-simple module
  // accepts walkingRadiusM directly, but we expose 2 friendlier fields :
  transportMode?: "walking" | "mixed" | "driving";
  radiusKm?: number;
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    drafts?: DraftInput[];
    runValidationNow?: boolean;
  };

  if (!body?.drafts || !Array.isArray(body.drafts) || body.drafts.length === 0) {
    return NextResponse.json(
      { error: "Body must contain non-empty 'drafts' array" },
      { status: 400 },
    );
  }
  if (body.drafts.length > 100) {
    return NextResponse.json(
      { error: "Max 100 drafts per request" },
      { status: 413 },
    );
  }

  const supabase = createAdminClient();
  const runNow = body.runValidationNow !== false; // default true

  const results: Array<{
    slug: string;
    status: "ok" | "skipped" | "error";
    diagnostics?: unknown;
    error?: string;
  }> = [];

  for (const d of body.drafts) {
    if (!d.slug || !d.city || !d.theme) {
      results.push({
        slug: d.slug ?? "(no slug)",
        status: "error",
        error: "missing required fields (slug + city + theme)",
      });
      continue;
    }

    // Upsert draft skeleton
    const { error: insErr } = await supabase
      .from("game_drafts")
      .upsert(
        {
          slug: d.slug,
          city: d.city,
          country: d.country ?? "France",
          theme: d.theme,
          theme_description: d.themeDescription ?? null,
          narrative: d.narrative ?? null,
          product_description: d.productDescription ?? null,
          mode: d.mode ?? "city_game",
          target_stop_count: d.targetStopCount ?? 8,
          start_point_text: d.startPointText ?? null,
          start_point_lat: d.startPointLat ?? null,
          start_point_lon: d.startPointLon ?? null,
          status: "pending",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "slug" },
      );
    if (insErr) {
      results.push({ slug: d.slug, status: "error", error: insErr.message });
      continue;
    }

    if (!runNow) {
      results.push({ slug: d.slug, status: "ok" });
      continue;
    }

    // Resolve startPoint : prefer explicit lat/lon, else geocode the text
    let startLat = d.startPointLat;
    let startLon = d.startPointLon;
    if ((!startLat || !startLon) && d.startPointText) {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        results.push({
          slug: d.slug,
          status: "error",
          error: "GOOGLE_MAPS_API_KEY missing — provide startPointLat+Lon explicitly",
        });
        continue;
      }
      try {
        const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(d.startPointText)}&inputtype=textquery&fields=geometry&key=${apiKey}`;
        const res = await fetch(url);
        const json = await res.json();
        const loc = json?.candidates?.[0]?.geometry?.location;
        if (loc?.lat && loc?.lng) {
          startLat = loc.lat;
          startLon = loc.lng;
        }
      } catch (e) {
        results.push({
          slug: d.slug,
          status: "error",
          error: `geocode failed: ${e instanceof Error ? e.message : "unknown"}`,
        });
        continue;
      }
    }
    if (!startLat || !startLon) {
      results.push({
        slug: d.slug,
        status: "error",
        error: "Could not resolve start point (provide startPointLat+Lon OR a valid startPointText)",
      });
      continue;
    }

    // Update draft with resolved startPoint (before queuing the event)
    await supabase
      .from("game_drafts")
      .update({
        start_point_lat: startLat,
        start_point_lon: startLon,
        updated_at: new Date().toISOString(),
      })
      .eq("slug", d.slug);

    // (2026-05-24) Emit Inngest event for ASYNC validation.
    // Perplexity deep-research = 5-10 min → Vercel timeout 300s impossible.
    // Inngest function runs without timeout, retries handled.
    try {
      await inngest.send({
        name: "draft/validate.requested",
        data: {
          slug: d.slug,
          city: d.city,
          country: d.country ?? "France",
          theme: d.theme,
          themeDescription: d.themeDescription ?? d.theme,
          productDescription: d.productDescription,
          startPointLat: startLat,
          startPointLon: startLon,
          // V5 (2026-05-26) : on propage AUSSI le texte original pour que
          // validate-draft puisse forcer ce landmark comme stop 1 (cohérence
          // PWA : "votre point de départ" = stop 1).
          startPointText: d.startPointText,
          targetStopCount: d.targetStopCount ?? 8,
          transportMode: d.transportMode,
          radiusKm: d.radiusKm,
        },
      });
      results.push({ slug: d.slug, status: "ok" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      await supabase
        .from("game_drafts")
        .update({
          status: "pending",
          validation_error: `Inngest send failed: ${msg}`,
          updated_at: new Date().toISOString(),
        })
        .eq("slug", d.slug);
      results.push({ slug: d.slug, status: "error", error: msg });
    }
  }

  return NextResponse.json({
    processed: results.length,
    ok: results.filter((r) => r.status === "ok").length,
    error: results.filter((r) => r.status === "error").length,
    results,
  });
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createAdminClient();
  const { data: drafts, error } = await supabase
    .from("game_drafts")
    .select(
      "id, slug, city, country, theme, mode, status, target_stop_count, start_point_lat, start_point_lon, diagnostics, validated_at, fulfilled_at, fulfilled_game_id, validation_error, created_at",
    )
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ drafts: drafts ?? [] });
}
