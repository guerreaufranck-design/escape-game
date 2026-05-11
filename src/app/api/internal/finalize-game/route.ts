/**
 * Internal endpoint — Lambda 2 of the chained pipeline.
 *
 * Called by /api/generate-game in fire-and-forget mode AFTER the game
 * has been inserted in DB with is_published=false. This endpoint runs
 * the heavy translation + audio + validator + auto-repair work, then
 * flips is_published=true if all checks pass.
 *
 * Auth: shared EXTERNAL_API_SECRET (same as /api/generate-game).
 *
 * maxDuration: 600s (10 min). Combined with the 10 min budget of the
 * generation lambda, the chained pipeline has 20 min effective budget,
 * enough to handle aggressive Gemini retries on rate-limit days.
 *
 * Idempotent: if called twice for the same gameId, the second call
 * acts as a "retry" (prepareGamePackage skips cached audio, validator
 * re-runs, auto-repair re-attempts unfinished issues). Safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { finalizeGame } from "@/lib/pipeline-finalize";
import { sendNeedsReviewAlert } from "@/lib/email";
import type { GameGenre } from "@/lib/game-genres";

export const maxDuration = 600;

interface FinalizeBody {
  gameId: string;
  language?: string;
  city: string;
  theme: string;
  narrative: string;
  genre?: GameGenre;
  // For the needsReview email alert
  slug: string;
  buyerEmail?: string;
  orderId?: string;
  callbackUrl?: string;
  callbackSecret?: string;
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const expectedSecret = process.env.EXTERNAL_API_SECRET;
    if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as FinalizeBody;
    const {
      gameId,
      language,
      city,
      theme,
      narrative,
      genre,
      slug,
      buyerEmail,
      orderId,
      callbackUrl,
      callbackSecret,
    } = body;

    if (!gameId || !city || !theme) {
      return NextResponse.json(
        { error: "Missing required fields: gameId, city, theme" },
        { status: 400 },
      );
    }

    console.log(
      `[finalize-game] Starting for gameId=${gameId}, language=${language || "(none)"}`,
    );

    const result = await finalizeGame({
      gameId,
      language,
      city,
      theme,
      narrative: narrative || "",
      genre,
    });

    console.log(
      `[finalize-game] Completed in ${Math.round(result.durationMs / 1000)}s — published=${result.isPublished}, needs_review=${result.needsReview}, iter=${result.validatorIterations}`,
    );

    // If needs_review, send the email alert so the operator knows
    if (result.needsReview && result.reviewReason) {
      try {
        await sendNeedsReviewAlert({
          gameId,
          slug,
          city,
          theme,
          reviewReason: result.reviewReason,
          buyerEmail,
          orderId,
        });
      } catch (alertErr) {
        console.error(
          `[finalize-game] needs_review alert failed: ${alertErr instanceof Error ? alertErr.message : alertErr}`,
        );
      }
    }

    // Send final callback to oddballtrip if a callback URL was provided.
    // Carries the FINAL needsReview state after the auto-repair loop.
    if (callbackUrl) {
      try {
        await fetch(callbackUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(callbackSecret && { Authorization: `Bearer ${callbackSecret}` }),
          },
          body: JSON.stringify({
            success: true,
            gameId,
            slug,
            finalized: true,
            isPublished: result.isPublished,
            ...(result.needsReview
              ? { needsReview: true, reviewReason: result.reviewReason }
              : {}),
          }),
        });
      } catch (err) {
        console.error(
          `[finalize-game] Final callback failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return NextResponse.json({
      success: true,
      gameId,
      isPublished: result.isPublished,
      needsReview: result.needsReview,
      validatorIterations: result.validatorIterations,
      audioGenerated: result.audioGenerated,
      durationMs: result.durationMs,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[finalize-game] Unexpected error:", errorMessage);
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 },
    );
  }
}
