import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSignedCode, verifyCodeSignature } from "@/lib/code-generator";

// Shared secret between fun-zone-tenerife and escape-game
const API_SECRET = process.env.CODE_API_SECRET || "FZ-EG-2026-sEcReT";

/**
 * POST /api/generate-code
 * Called by fun-zone-tenerife after a purchase to generate an activation code.
 *
 * Headers:
 *   x-api-secret: shared secret for authentication
 *
 * Body:
 *   { gameId: string, customerEmail?: string, customerName?: string }
 *
 * Returns:
 *   { code: string, gameId: string, expiresAt: string }
 */
export async function POST(request: NextRequest) {
  try {
    // Verify API secret
    const secret = request.headers.get("x-api-secret");
    if (secret !== API_SECRET) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { gameId, customerEmail, customerName } = body;

    if (!gameId) {
      return NextResponse.json(
        { error: "gameId is required" },
        { status: 400 }
      );
    }

    // Generate a signed code
    let code: string;
    try {
      code = generateSignedCode(gameId);
    } catch {
      return NextResponse.json(
        { error: "Invalid gameId" },
        { status: 400 }
      );
    }

    // Double-check signature
    const verified = verifyCodeSignature(code);
    if (verified !== gameId) {
      return NextResponse.json(
        { error: "Code generation error" },
        { status: 500 }
      );
    }

    // Expiration: 8 hours from activation (not from generation)
    // We store the code with expires_at = null (set on activation)
    const supabase = createAdminClient();

    const { error: dbError } = await supabase
      .from("activation_codes")
      .insert({
        code,
        game_id: gameId,
        is_single_use: true,
        max_uses: 1,
        current_uses: 0,
        team_name: customerName || null,
        // expires_at is set to null - will be set to now+8h on activation
      });

    if (dbError) {
      // Code collision (extremely unlikely) - retry once
      const retryCode = generateSignedCode(gameId);
      const { error: retryError } = await supabase
        .from("activation_codes")
        .insert({
          code: retryCode,
          game_id: gameId,
          is_single_use: true,
          max_uses: 1,
          current_uses: 0,
          team_name: customerName || null,
        });

      if (retryError) {
        return NextResponse.json(
          { error: "Failed to create code" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        code: retryCode,
        gameId,
        customerEmail,
      });
    }

    return NextResponse.json({
      code,
      gameId,
      customerEmail,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
