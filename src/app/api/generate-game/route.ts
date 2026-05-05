/**
 * API Route: POST /api/generate-game
 *
 * Triggers the full game generation pipeline:
 * Perplexity (research) → Claude (creation) → Supabase (storage)
 *
 * Can be called by:
 * - Admin dashboard (manual generation)
 * - Stripe webhook (automatic on purchase)
 * - External API with auth
 *
 * Body: {
 *   city: string,
 *   country: string,
 *   theme: string,
 *   themeDescription: string,
 *   narrative: string,
 *   difficulty?: number (1-5, default 3),
 *   estimatedDurationMin?: number (default 90),
 *   coverImage?: string
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  generateGameFromTemplate,
  type GameTemplate,
} from "@/lib/game-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPipelineFailureAlert } from "@/lib/email";

// Pipeline can take 5-7 minutes (Perplexity deep research is slow)
export const maxDuration = 600; // 10 minutes max

export async function POST(request: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {};
  try {
    // Verify authorization
    const authHeader = request.headers.get("authorization");
    const expectedSecret = process.env.EXTERNAL_API_SECRET;

    if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    body = await request.json();
    console.log("[GenerateGame] Received body:", JSON.stringify({
      city: body.city, country: body.country, theme: body.theme,
      hasThemeDesc: !!body.themeDescription, hasNarrative: !!body.narrative,
      stopsCount: body.stops?.length, slug: body.slug,
      hasCallback: !!body.callbackUrl,
      hasStartPoint: !!body.startPoint,
      buyerEmail: body.buyerEmail || "N/A",
    }));

    // Validate required fields
    const { city, country, theme, themeDescription, narrative } = body;

    if (!city || !country || !theme || !themeDescription || !narrative) {
      return NextResponse.json(
        {
          error: "Missing required fields",
          required: [
            "city",
            "country",
            "theme",
            "themeDescription",
            "narrative",
          ],
        },
        { status: 400 }
      );
    }

    // Parse predefined stops from oddballtrip. The new contract adds
    // an optional `landmarkName` field per stop — the real building
    // name used by the pipeline to fetch authoritative GPS coords
    // (sub-10 m via Google Places). When missing, the pipeline falls
    // back to geocoding `name`, which works only when `name` happens
    // to be a real, findable landmark (likely fails on poetic names).
    const stops = Array.isArray(body.stops)
      ? body.stops
          .filter((s: { name?: string }) => s?.name?.trim())
          .map(
            (s: {
              name: string;
              landmarkName?: string;
              description?: string;
            }) => ({
              name: s.name.trim(),
              landmarkName: s.landmarkName?.trim() || undefined,
              description: s.description?.trim() || "",
            }),
          )
      : undefined;

    // Point de départ du parcours. CONTRAT: oddballtrip dispose du
    // startPoint dans chaque fiche de jeu et DOIT le transmettre.
    // C'est ce point qui sert de référence au filtre 1.5 km, à l'auto-
    // discovery et au NN reorder. Sans lui, on retombe sur le 1er stop
    // géocodé (heuristique correcte mais moins fiable, surtout pour les
    // grandes villes où le parcours peut être dans un quartier).
    //
    // Accepte plusieurs formats au cas où l'amont varie :
    //   { lat, lon } | { latitude, longitude } | { lat, lng }
    let startPoint: { lat: number; lon: number } | undefined;
    if (body.startPoint && typeof body.startPoint === "object") {
      const sp = body.startPoint as Record<string, unknown>;
      const lat = typeof sp.lat === "number" ? sp.lat : typeof sp.latitude === "number" ? sp.latitude : null;
      const lon = typeof sp.lon === "number" ? sp.lon : typeof sp.longitude === "number" ? sp.longitude : typeof sp.lng === "number" ? sp.lng : null;
      if (lat !== null && lon !== null) {
        startPoint = { lat, lon };
      } else {
        console.warn(
          `[GenerateGame] ⚠ body.startPoint provided but missing lat/lon (got keys: ${Object.keys(sp).join(",")}) — ignoring, fallback to first geocoded stop`,
        );
      }
    } else {
      console.warn(
        `[GenerateGame] ⚠ MISSING startPoint in payload — oddballtrip must transmit { startPoint: { lat, lon } } on every request. Falling back to first geocoded operator stop, which is approximate.`,
      );
    }

    const template: GameTemplate = {
      slug:
        body.slug ||
        `${city.toLowerCase().replace(/\s+/g, "-")}-${theme.toLowerCase().replace(/\s+/g, "-")}`,
      city,
      country,
      theme,
      themeDescription,
      narrative,
      difficulty: body.difficulty || 3,
      estimatedDurationMin: body.estimatedDuration || body.estimatedDurationMin || 90,
      coverImage: body.coverImage || null,
      stops,
      startPoint,
    };

    // Idempotency: if a game with this slug already exists, return it
    const supabase = createAdminClient();
    const { data: existingGame } = await supabase
      .from("games")
      .select("id")
      .eq("slug", template.slug)
      .eq("is_published", true)
      .single();

    if (existingGame) {
      console.log(`[GenerateGame] Game already exists for slug "${template.slug}" → ${existingGame.id}`);

      // Still send callback so oddballtrip can process pending purchases
      if (body.callbackUrl) {
        try {
          await fetch(body.callbackUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(body.callbackSecret && { Authorization: `Bearer ${body.callbackSecret}` }),
            },
            body: JSON.stringify({ gameId: existingGame.id, slug: template.slug }),
          });
        } catch (err) {
          console.error(`[GenerateGame] Callback failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      return NextResponse.json(
        {
          success: true,
          gameId: existingGame.id,
          alreadyExists: true,
          message: `Game "${template.slug}" already exists`,
        },
        { status: 200 }
      );
    }

    // Run the pipeline
    const result = await generateGameFromTemplate(template);

    if (result.success) {
      // Send callback to oddballtrip if provided (must await on Vercel serverless)
      if (body.callbackUrl) {
        console.log(`[GenerateGame] Sending callback to ${body.callbackUrl}`);
        try {
          const cbRes = await fetch(body.callbackUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(body.callbackSecret && {
                Authorization: `Bearer ${body.callbackSecret}`,
              }),
            },
            body: JSON.stringify({
              success: true,
              gameId: result.gameId,
              slug: body.slug || template.slug,
              stepsCount: result.steps,
              // Présent ssi un ou plusieurs stops ont été retirés du
              // parcours. Le jeu publie quand même (>= 6 stops). Permet
              // à oddballtrip d'afficher un warning à l'opérateur et,
              // si nécessaire, de planifier une re-génération avec des
              // landmarkName corrigés.
              ...(result.droppedStops?.length
                ? { droppedStops: result.droppedStops }
                : {}),
              // Présent ssi un ou plusieurs stops ont été auto-remplacés
              // par un POI réel découvert via Google Places. La narration
              // a été régénérée — oddballtrip DOIT mettre à jour la
              // fiche produit avec `adaptedNarrative.themeDescription`
              // et `adaptedNarrative.narrative`, sinon le client achète
              // un scénario qui ne correspond plus à ce qu'il joue.
              ...(result.replacedStops?.length
                ? {
                    narrativeChanged: true,
                    replacedStops: result.replacedStops,
                    adaptedNarrative: result.adaptedNarrative,
                  }
                : {}),
            }),
          });
          console.log(`[GenerateGame] Callback response: ${cbRes.status} ${cbRes.statusText}`);
        } catch (err) {
          console.error(`[GenerateGame] Callback failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      // If stops were dropped, fire a warning email to the admin (and
      // oddballtrip ops via ODDBALLTRIP_ALERT_EMAIL). The game IS
      // published, so this is not a pipeline failure — but the team
      // wants to know which landmarkName(s) got dropped so they can
      // tighten them in the generator prompt.
      if (result.droppedStops?.length) {
        try {
          await sendPipelineFailureAlert({
            city,
            country,
            theme,
            slug: template.slug,
            error: `${result.droppedStops.length} stop(s) dropped — game published with ${result.steps} stops instead of ${stops?.length ?? "?"}`,
            errorCode: "STOPS_DROPPED",
            failedLandmarks: result.droppedStops,
            durationSeconds: Math.round((result.durationMs || 0) / 1000),
            buyerEmail: body.buyerEmail,
            orderId: body.orderId,
          });
        } catch (alertErr) {
          console.error(
            `[GenerateGame] Dropped-stops alert failed: ${alertErr instanceof Error ? alertErr.message : alertErr}`,
          );
        }
      }

      // If stops were auto-replaced, fire a notification email so the
      // sales team knows the product page must be updated to match the
      // regenerated narrative. The game IS published — this is not a
      // failure, just an operational handover.
      if (result.replacedStops?.length) {
        try {
          await sendPipelineFailureAlert({
            city,
            country,
            theme,
            slug: template.slug,
            error: `${result.replacedStops.length} stop(s) auto-replaced via Google Places — narrative regenerated, product page must be refreshed.`,
            errorCode: "STOPS_REPLACED",
            replacedStops: result.replacedStops.map((r) => ({
              original: r.original,
              replacement: r.replacement,
            })),
            adaptedNarrative: result.adaptedNarrative,
            durationSeconds: Math.round((result.durationMs || 0) / 1000),
            buyerEmail: body.buyerEmail,
            orderId: body.orderId,
          });
        } catch (alertErr) {
          console.error(
            `[GenerateGame] Replaced-stops alert failed: ${alertErr instanceof Error ? alertErr.message : alertErr}`,
          );
        }
      }

      return NextResponse.json(
        {
          success: true,
          gameId: result.gameId,
          steps: result.steps,
          durationSeconds: Math.round((result.durationMs || 0) / 1000),
          researchDurationMs: result.researchDurationMs,
          creationDurationMs: result.creationDurationMs,
          message: `Game "${theme}" in ${city} created successfully`,
          ...(result.droppedStops?.length
            ? { droppedStops: result.droppedStops }
            : {}),
          ...(result.replacedStops?.length
            ? {
                narrativeChanged: true,
                replacedStops: result.replacedStops,
                adaptedNarrative: result.adaptedNarrative,
              }
            : {}),
        },
        { status: 201 }
      );
    } else {
      console.error("[GenerateGame] Pipeline failed:", result.error);

      // Send failure alert email to admin (CC: oddballtrip ops if
      // ODDBALLTRIP_ALERT_EMAIL is set). Threads through the
      // structured errorCode + failedLandmarks so the email body
      // shows the operator the exact list of names to fix.
      await sendPipelineFailureAlert({
        city,
        country,
        theme,
        slug: template.slug,
        error: result.error || "Unknown pipeline error",
        errorCode: result.errorCode,
        failedLandmarks: result.failedLandmarks,
        durationSeconds: Math.round((result.durationMs || 0) / 1000),
        buyerEmail: body.buyerEmail,
        orderId: body.orderId,
      });

      // Send failure callback to OddballTrip so it can handle the
      // client. Structured payload so oddballtrip can switch on the
      // errorCode (notably GEOCODING_FAILED → show the operator the
      // failedLandmarks to fix and resubmit).
      if (body.callbackUrl) {
        try {
          await fetch(body.callbackUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(body.callbackSecret && { Authorization: `Bearer ${body.callbackSecret}` }),
            },
            body: JSON.stringify({
              success: false,
              slug: template.slug,
              errorCode: result.errorCode ?? "INTERNAL_ERROR",
              error: result.error,
              ...(result.failedLandmarks?.length
                ? { failedLandmarks: result.failedLandmarks }
                : {}),
            }),
          });
        } catch (cbErr) {
          console.error(`[GenerateGame] Failure callback failed: ${cbErr instanceof Error ? cbErr.message : cbErr}`);
        }
      }

      return NextResponse.json(
        {
          success: false,
          errorCode: result.errorCode ?? "INTERNAL_ERROR",
          error: result.error,
          ...(result.failedLandmarks?.length
            ? { failedLandmarks: result.failedLandmarks }
            : {}),
          durationSeconds: Math.round((result.durationMs || 0) / 1000),
        },
        { status: 500 }
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    console.error("[GenerateGame] Unexpected error:", errorMessage);

    // Send alert even for unexpected errors
    await sendPipelineFailureAlert({
      city: body?.city || "Unknown",
      country: body?.country || "Unknown",
      theme: body?.theme || "Unknown",
      slug: body?.slug || "unknown",
      error: errorMessage,
      buyerEmail: body?.buyerEmail,
      orderId: body?.orderId,
    });

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
