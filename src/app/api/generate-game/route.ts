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

// Pipeline can take 5-7 minutes (Perplexity deep research is slow)
export const maxDuration = 600; // 10 minutes max

export async function POST(request: NextRequest) {
  try {
    // Verify authorization
    const authHeader = request.headers.get("authorization");
    const expectedSecret = process.env.EXTERNAL_API_SECRET;

    if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    console.log("[GenerateGame] Received body:", JSON.stringify({
      city: body.city, country: body.country, theme: body.theme,
      hasThemeDesc: !!body.themeDescription, hasNarrative: !!body.narrative,
      stopsCount: body.stops?.length, slug: body.slug,
      hasCallback: !!body.callbackUrl
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
    console.error("[GenerateGame] Unexpected error:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
