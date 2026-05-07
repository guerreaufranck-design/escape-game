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
import { sendPipelineFailureAlert, sendNeedsReviewAlert } from "@/lib/email";
import { parseGenre } from "@/lib/game-genres";

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
      language: body.language || "(none)",
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
    // Post-refonte Phase 12 (2026-05-07), TOUTES les fiches DB ont un
    // startPoint correct géocodé sub-degré. La validation ci-dessous
    // rejette précocement les payloads malformés.
    //
    // Accepte plusieurs formats au cas où l'amont varie :
    //   { lat, lon } | { latitude, longitude } | { lat, lng }
    let startPoint: { lat: number; lon: number } | undefined;
    if (body.startPoint && typeof body.startPoint === "object") {
      const sp = body.startPoint as Record<string, unknown>;
      const lat = typeof sp.lat === "number" ? sp.lat : typeof sp.latitude === "number" ? sp.latitude : null;
      const lon = typeof sp.lon === "number" ? sp.lon : typeof sp.longitude === "number" ? sp.longitude : typeof sp.lng === "number" ? sp.lng : null;
      if (lat !== null && lon !== null) {
        // Validation pre-discovery : reject 400 sur lat/lon hors range
        // ou null-island absurde (lat=0,lon=0 hors zone Greenwich).
        // Coupe net les payloads cassés AVANT de payer Perplexity/Claude.
        const isPrimeMeridianGreenwich =
          lon === 0 && lat >= 51.45 && lat <= 51.5;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          return NextResponse.json(
            {
              error: "Invalid startPoint coords (lat or lon out of range)",
              startPoint: { lat, lon },
            },
            { status: 400 },
          );
        }
        if ((lat === 0 || lon === 0) && !isPrimeMeridianGreenwich) {
          return NextResponse.json(
            {
              error: "Invalid startPoint coords (null-island 0,0 likely a bug — only Greenwich Royal Observatory is allowed at lon=0)",
              startPoint: { lat, lon },
            },
            { status: 400 },
          );
        }
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

    // Description textuelle du checkpoint envoyée par oddballtrip — accepte
    // plusieurs noms de champs pour robustesse (en attendant un contrat
    // unifié). Le pipeline géocode ce texte comme source d'autorité PRÉCISE
    // (parvis, fontaine, place exacte) avant de tomber sur le city center.
    const startPointText: string | undefined = (() => {
      const candidates = [
        body.startPointText,
        body.startPointDescription,
        body.meetingPoint,
        body.checkpoint,
        body.meetingLocation,
      ];
      for (const c of candidates) {
        if (typeof c === "string" && c.trim().length > 0) return c.trim();
      }
      return undefined;
    })();

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
      startPointText,
      // body.stops est silencieusement ignoré par le pipeline intent-first
      // (cf. game-pipeline.ts) — on le passe quand même au template pour
      // que le log "ignored" se déclenche dans la pipeline et que oddballtrip
      // voit qu'on a reçu mais pas utilisé.
      stops,
      startPoint,
      // stopCount : combien de landmarks Perplexity doit produire. Si
      // oddballtrip envoie body.stops[] legacy on prend sa longueur ;
      // sinon body.stopCount ; sinon 8.
      stopCount:
        typeof body.stopCount === "number"
          ? body.stopCount
          : (stops?.length ?? 8),
      // language : code ISO 2 lettres ("fr", "en", "de"...). Si présent,
      // le pipeline pré-génère TOUS les audios + traductions dans cette
      // langue après l'insert DB. Si absent, log warning + lazy gen
      // pendant la session (latence joueur).
      //
      // Accepte ISO 639-1 + BCP-47 + locale variants :
      //   "fr"     → "fr"
      //   "fr-FR"  → "fr"  (Stripe / browsers)
      //   "fr_FR"  → "fr"
      //   "FR"     → "fr"
      // Tout le reste → undefined → fallback warning + lazy gen.
      language: (() => {
        if (typeof body.language !== "string") return undefined;
        const m = body.language.toLowerCase().trim().match(/^([a-z]{2})(?:[-_][a-z0-9]+)?$/);
        return m ? m[1] : undefined;
      })(),
      // genre : tonalité narrative choisie par l'opérateur (historical,
      // fantasy, mystery, romance, supernatural, espionnage, cinema,
      // fairytale). Fallback `historical` si absent ou invalide. MVP en
      // mémoire — pas de col DB ; cf. game-genres.ts.
      genre: parseGenre(body.genre),
    };

    // Note (2026-05-07) : les 3 maps d'override hardcodées (genre,
    // stopCount, startPoint) ont été supprimées suite à la refonte
    // Phase 12 d'oddballtrip qui produit désormais des fiches avec
    // les bons champs. La validation runtime (cluster centroid post-
    // discovery) attrape les cas exceptionnels en posant le flag
    // `games.needs_review` plutôt qu'en patchant à l'aveugle.

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
              // Flag de review : posé par le pipeline quand la sanity-
              // check post-discovery détecte une anomalie (cluster
              // centroid > 5 km du startPoint). oddballtrip DOIT tenir
              // l'envoi du code activation au client tant que l'opérateur
              // n'a pas inspecté/corrigé via dump-game + edit-step.
              ...(result.needsReview
                ? { needsReview: true, reviewReason: result.reviewReason }
                : {}),
              // CANONIQUE intent-first : la liste des landmarks réels
              // qui ont été utilisés pour générer le jeu (issue de
              // Perplexity + Google Places, sub-10m). oddballtrip DOIT
              // s'en servir pour rafraîchir la fiche produit, sinon
              // la page indexée diverge de l'expérience jouée.
              ...(result.landmarks?.length
                ? { landmarks: result.landmarks }
                : {}),
              // Le scénario adapté aux landmarks réels (themeDescription
              // + narrative + noms poétiques par stop). Toujours présent
              // sauf si l'adaptation Claude a planté (graceful degrad).
              // À utiliser pour rafraîchir la fiche produit côté
              // commerce — sinon le client achète X et joue Y.
              ...(result.adaptedNarrative
                ? {
                    narrativeChanged: true,
                    adaptedNarrative: result.adaptedNarrative,
                  }
                : {}),
              // Audit non-actionnable : candidats Perplexity rejetés
              // pour cause de géocodage ou walkability. Affichage
              // optionnel pour l'opérateur, ne nécessite aucune action.
              ...(result.droppedStops?.length
                ? { droppedStops: result.droppedStops }
                : {}),
            }),
          });
          console.log(`[GenerateGame] Callback response: ${cbRes.status} ${cbRes.statusText}`);
        } catch (err) {
          console.error(`[GenerateGame] Callback failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Alerte needs_review : si la sanity-check post-discovery a flaggé
      // ce jeu, on prévient l'opérateur AVANT que le code activation
      // soit envoyé au client. Email non-bloquant.
      if (result.needsReview && result.gameId && result.reviewReason) {
        try {
          await sendNeedsReviewAlert({
            gameId: result.gameId,
            slug: template.slug,
            city: template.city,
            theme: template.theme,
            reviewReason: result.reviewReason,
            buyerEmail: body.buyerEmail,
            orderId: body.orderId,
          });
        } catch (alertErr) {
          console.error(
            `[GenerateGame] needs_review alert failed: ${alertErr instanceof Error ? alertErr.message : alertErr}`,
          );
        }
      }

      // Email STOPS_DROPPED retiré : dans l'architecture Google-first,
      // les "drops" (candidats Google non-pickés par Claude) sont en
      // réalité juste les non-sélectionnés — ce sont des choix, pas
      // des échecs. Avec 60 candidats Google et stopCount=8, on a
      // mathématiquement 52 "non-pickés" qui ne sont pas un problème.
      // L'email "52 stops dropped — game published with 8 stops
      // instead of 8" était trompeur. Si un VRAI problème survient
      // (walkability filter drop, geocoding fail), il est remonté
      // dans le callback comme `droppedStops` pour audit, mais ne
      // déclenche plus d'email d'alerte (qui spammait pour rien).

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
          ...(result.needsReview
            ? { needsReview: true, reviewReason: result.reviewReason }
            : {}),
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
        startPoint: template.startPoint,
        stopCount: template.stopCount,
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
