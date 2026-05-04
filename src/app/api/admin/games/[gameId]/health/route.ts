/**
 * GET /api/admin/games/[gameId]/health
 *
 * Read-only audit of a game's data completeness (no AI calls, no
 * mutations). Powers the green/yellow/red status badge in the admin
 * games list.
 */
import { NextResponse } from "next/server";
import { auditGameHealth } from "@/lib/game-health";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;
  if (!gameId) {
    return NextResponse.json({ error: "missing gameId" }, { status: 400 });
  }
  try {
    const health = await auditGameHealth(gameId);
    return NextResponse.json(health);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Erreur interne lors de l'audit",
      },
      { status: 500 },
    );
  }
}
