/**
 * API Route: POST /api/games/preview
 *
 * Endpoint de PREVIEW d'un parcours (sans génération d'énigmes ni
 * insertion DB). Permet à oddballtrip d'appeler escape-game depuis son
 * back-office d'édition pour récupérer la liste de landmarks réels +
 * la narration adaptée AVANT de publier la fiche produit.
 *
 * Avantage : la fiche produit publiée chez oddballtrip est dès le
 * départ alignée avec ce que générera /api/games/generate au moment
 * de l'achat — plus de "page vendue ≠ jeu joué".
 *
 * Latence : ~30 secondes (Perplexity + géocodage des candidats +
 * Claude pour adapter le scénario). Pas de génération d'énigmes
 * (qui prendrait 5+ minutes en plus).
 *
 * Body (identique à /api/games/generate) :
 * {
 *   city, country, theme, themeDescription, narrative,
 *   startPoint: { lat, lon },
 *   stopCount?: number (default 8)
 * }
 *
 * Réponse :
 * {
 *   success: true,
 *   landmarks: PublishedLandmark[],   // les POIs réels qui seront dans le jeu
 *   adaptedNarrative: {                // scénario adapté aux landmarks
 *     themeDescription, narrative, stopNames
 *   },
 *   rejected: Array<{ name, reason }>  // candidats Perplexity écartés (audit)
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { discoverParcours } from "@/lib/parcours-discovery";
import { adaptNarrativeForReplacedStops } from "@/lib/anthropic";
import { geocodeLocation } from "@/lib/geocode";

// Preview = Perplexity (~10s) + geocoding (~5s) + adaptNarrative (~10s)
// = ~30s typique. On laisse 60s de marge.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {};
  try {
    // Verify authorization (same secret as /api/games/generate)
    const authHeader = request.headers.get("authorization");
    const expectedSecret = process.env.EXTERNAL_API_SECRET;
    if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    body = await request.json();
    console.log(
      "[GamePreview] Received body:",
      JSON.stringify({
        city: body.city,
        country: body.country,
        theme: body.theme,
        hasThemeDesc: !!body.themeDescription,
        hasNarrative: !!body.narrative,
        hasStartPoint: !!body.startPoint,
        stopCount: body.stopCount,
      }),
    );

    const { city, country, theme, themeDescription, narrative } = body;
    if (!city || !country || !theme || !themeDescription || !narrative) {
      return NextResponse.json(
        {
          error: "Missing required fields",
          required: ["city", "country", "theme", "themeDescription", "narrative"],
        },
        { status: 400 },
      );
    }

    // Parse startPoint (3 conventions tolérées)
    let startPoint: { lat: number; lon: number } | undefined;
    if (body.startPoint && typeof body.startPoint === "object") {
      const sp = body.startPoint as Record<string, unknown>;
      const lat =
        typeof sp.lat === "number"
          ? sp.lat
          : typeof sp.latitude === "number"
            ? sp.latitude
            : null;
      const lon =
        typeof sp.lon === "number"
          ? sp.lon
          : typeof sp.longitude === "number"
            ? sp.longitude
            : typeof sp.lng === "number"
              ? sp.lng
              : null;
      if (lat !== null && lon !== null) {
        startPoint = { lat, lon };
      }
    }

    // Fallback : géocoder le centre-ville si oddballtrip n'a pas
    // transmis startPoint. Moins précis pour les grandes villes mais
    // permet de débloquer l'usage initial.
    if (!startPoint) {
      console.warn(
        `[GamePreview] ⚠ MISSING startPoint — falling back to city center geocode for "${city}, ${country}"`,
      );
      const cityGeo = await geocodeLocation(`${city}, ${country}`, city, country);
      if (!cityGeo) {
        return NextResponse.json(
          {
            success: false,
            error: `Cannot geocode city center as fallback startPoint for "${city}, ${country}". Please transmit startPoint explicitly.`,
          },
          { status: 400 },
        );
      }
      startPoint = { lat: cityGeo.lat, lon: cityGeo.lon };
    }

    const stopCount = typeof body.stopCount === "number" ? body.stopCount : 8;

    // === Discovery ===
    const discovery = await discoverParcours({
      city,
      country,
      theme,
      themeDescription,
      narrative,
      startPoint,
      stopCount,
    });

    if (!discovery.success) {
      return NextResponse.json(
        {
          success: false,
          errorCode: discovery.errorCode,
          error: discovery.error,
          rejected: discovery.rejected,
        },
        { status: 422 },
      );
    }

    // === Adapt narrative ===
    let adaptedNarrative:
      | {
          themeDescription: string;
          narrative: string;
          stopNames: string[];
        }
      | undefined;
    let effectiveStopNames = discovery.landmarks.map((s) => s.name);
    let effectiveDescriptions = discovery.landmarks.map((s) => s.description);
    try {
      const adapted = await adaptNarrativeForReplacedStops({
        city,
        country,
        theme,
        originalNarrative: narrative,
        finalStops: discovery.landmarks.map((s) => ({
          landmarkName: s.name,
          types: [],
          address: undefined,
          keptPoeticName: undefined,
          keptDescription: s.description,
          isReplacement: true,
        })),
      });
      adaptedNarrative = {
        themeDescription: adapted.themeDescription,
        narrative: adapted.narrative,
        stopNames: adapted.stops.map((s) => s.name),
      };
      effectiveStopNames = adapted.stops.map((s) => s.name);
      effectiveDescriptions = adapted.stops.map((s) => s.description);
    } catch (err) {
      console.warn(
        `[GamePreview] adaptNarrativeForReplacedStops failed: ${err instanceof Error ? err.message : err} — returning landmarks with raw Perplexity descriptions`,
      );
    }

    return NextResponse.json(
      {
        success: true,
        landmarks: discovery.landmarks.map((s, i) => ({
          name: effectiveStopNames[i],
          landmarkName: s.name,
          lat: s.lat,
          lon: s.lon,
          description: effectiveDescriptions[i],
          source: s.source,
          distanceFromStartM: s.distanceFromStartM,
        })),
        adaptedNarrative,
        rejected: discovery.rejected,
      },
      { status: 200 },
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[GamePreview] Unexpected error:", errorMessage);
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 },
    );
  }
}
