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

    // Parse optional predefined stops from oddballtrip
    const stops = Array.isArray(body.stops)
      ? body.stops
          .filter((s: { name?: string }) => s?.name?.trim())
          .map((s: { name: string; description?: string }) => ({
            name: s.name.trim(),
            description: s.description?.trim() || "",
          }))
      : undefined;

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
              gameId: result.gameId,
              slug: body.slug || template.slug,
            }),
          });
          console.log(`[GenerateGame] Callback response: ${cbRes.status} ${cbRes.statusText}`);
        } catch (err) {
          console.error(`[GenerateGame] Callback failed: ${err instanceof Error ? err.message : err}`);
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
        },
        { status: 201 }
      );
    } else {
      console.error("[GenerateGame] Pipeline failed:", result.error);

      // Send failure alert email to admin
      await sendPipelineFailureAlert({
        city,
        country,
        theme,
        slug: template.slug,
        error: result.error || "Unknown pipeline error",
        durationSeconds: Math.round((result.durationMs || 0) / 1000),
        buyerEmail: body.buyerEmail,
        orderId: body.orderId,
      });

      // Send failure callback to OddballTrip so it can handle the client
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
              error: result.error,
              slug: template.slug,
            }),
          });
        } catch (cbErr) {
          console.error(`[GenerateGame] Failure callback failed: ${cbErr instanceof Error ? cbErr.message : cbErr}`);
        }
      }

      return NextResponse.json(
        {
          success: false,
          error: result.error,
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
