import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateApiKey, corsHeaders } from "@/lib/external-auth";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/external/find-game?slug=la-citadelle-de-navarre
 *
 * Called by oddballtrip to check if a game has been generated and published.
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  POLITIQUE 2026-05-15 — EXACT SLUG MATCH ONLY
 * ═══════════════════════════════════════════════════════════════════════
 *
 * AVANT (legacy) : si le slug exact n'existait pas en is_published=true,
 * on faisait un fuzzy match keyword sur title+city. ÇA A CASSÉ EN PROD :
 * Julien Barras a acheté "la-resistance-d-alba" (Alba, Italie). La
 * pipeline n'avait pas encore généré le game. Le fuzzy match a matché
 * "Albarracín" (Espagne, vieux jeu) parce que "alba" est inclus dans
 * "albarracín". Le code activation a été lié au mauvais game.
 *
 * MAINTENANT : on retourne 404 STRICT si le slug exact n'est pas trouvé.
 * OddballTrip doit poller cet endpoint jusqu'à ce que la pipeline finisse
 * et que is_published=true. C'est le seul comportement qui garantit
 * qu'un code activation est lié au bon game.
 *
 * Conséquence pour OddballTrip : ils DOIVENT implémenter le polling
 * côté eux (s'ils ne l'avaient pas déjà). Polling typique :
 *   - Toutes les 30s pendant 30 min après l'achat
 *   - Après 30 min sans 200, alerte opérateur
 */
export async function GET(request: NextRequest) {
  if (!validateApiKey(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders }
    );
  }

  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json(
      { error: "slug parameter required" },
      { status: 400, headers: corsHeaders }
    );
  }

  const supabase = createAdminClient();

  // EXACT slug match — la seule politique valide.
  const { data: exactMatch } = await supabase
    .from("games")
    .select("id, title, city")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (exactMatch) {
    console.log(
      `[find-game] EXACT slug match "${slug}" → gameId=${exactMatch.id}`,
    );
    return NextResponse.json(
      {
        found: true,
        gameId: exactMatch.id,
        title: extractTitle(exactMatch.title),
        city: exactMatch.city,
        slug,
      },
      { headers: corsHeaders },
    );
  }

  // PAS DE FUZZY MATCH. 404 strict. OddballTrip doit poller.
  //
  // (Diagnostic) Avant de retourner 404, on vérifie s'il y a un game
  // avec ce slug MAIS is_published=false (= pipeline en cours).
  // Si oui, on retourne un signal explicite "pending" pour qu'OddballTrip
  // sache qu'il doit attendre plutôt que de paniquer.
  const { data: pendingGame } = await supabase
    .from("games")
    .select("id, needs_review, created_at")
    .eq("slug", slug)
    .eq("is_published", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingGame) {
    const ageMin =
      (Date.now() - new Date(pendingGame.created_at).getTime()) / 60_000;
    console.log(
      `[find-game] PENDING slug="${slug}" gameId=${pendingGame.id} age=${Math.round(ageMin)}min needs_review=${pendingGame.needs_review}`,
    );
    return NextResponse.json(
      {
        found: false,
        pending: true,
        needs_review: pendingGame.needs_review,
        age_min: Math.round(ageMin),
        slug,
        hint: pendingGame.needs_review
          ? "Game is awaiting human review — operator must release it manually."
          : "Game is being generated — keep polling every 30s.",
      },
      { status: 202, headers: corsHeaders }, // 202 Accepted = en cours
    );
  }

  console.log(
    `[find-game] NOT FOUND slug="${slug}" — no published or pending game with this slug`,
  );
  return NextResponse.json(
    {
      found: false,
      pending: false,
      slug,
      hint:
        "No game exists with this slug. Either it has not been generated yet (call /api/games/generate first) or the slug is wrong.",
    },
    { status: 404, headers: corsHeaders },
  );
}

/** Extract a clean display title from a games.title (string or JSONB). */
function extractTitle(title: unknown, lang = "en"): string {
  if (typeof title === "string") {
    try {
      const parsed = JSON.parse(title);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed[lang] || parsed.en || parsed.fr || Object.values(parsed)[0] || title;
      }
    } catch {
      /* not JSON */
    }
    return title;
  }
  if (typeof title === "object" && title !== null) {
    const obj = title as Record<string, string>;
    return obj[lang] || obj.en || obj.fr || Object.values(obj)[0] || "";
  }
  return String(title || "");
}
