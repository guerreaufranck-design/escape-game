import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateApiKey, corsHeaders } from "@/lib/external-auth";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/external/find-game?slug=la-citadelle-de-navarre
 *
 * Called by oddballtrip to check if a game has been generated.
 * Searches published games by matching slug keywords against title/city.
 *
 * Returns the gameId if found, or 404 if not.
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

  // Get all published games (there won't be thousands, this is fine)
  const { data: games, error } = await supabase
    .from("games")
    .select("id, title, city, is_published")
    .eq("is_published", true);

  if (error) {
    console.error("[find-game] Query error:", error);
    return NextResponse.json(
      { error: "Database error" },
      { status: 500, headers: corsHeaders }
    );
  }

  if (!games || games.length === 0) {
    return NextResponse.json(
      { found: false, slug },
      { status: 404, headers: corsHeaders }
    );
  }

  // Extract search keywords from slug: "la-citadelle-de-navarre" → ["citadelle", "navarre"]
  const keywords = slug
    .toLowerCase()
    .split("-")
    .filter((w) => w.length > 3 && !["les", "des", "the", "and", "del", "las", "los", "pour", "dans", "avec", "from"].includes(w));

  // Extract a clean display title (for API response)
  function extractTitle(title: unknown, lang = "en"): string {
    if (typeof title === "string") {
      try {
        const parsed = JSON.parse(title);
        if (typeof parsed === "object" && parsed !== null) {
          return parsed[lang] || parsed.en || parsed.fr || Object.values(parsed)[0] || title;
        }
      } catch { /* not JSON */ }
      return title;
    }
    if (typeof title === "object" && title !== null) {
      const obj = title as Record<string, string>;
      return obj[lang] || obj.en || obj.fr || Object.values(obj)[0] || "";
    }
    return String(title || "");
  }

  // Extract title text from each game (handles both string and JSONB titles)
  function getTitleText(title: unknown): string {
    if (typeof title === "string") {
      // Could be a plain string or a JSON string
      try {
        const parsed = JSON.parse(title);
        if (typeof parsed === "object" && parsed !== null) {
          return Object.values(parsed).join(" ").toLowerCase();
        }
      } catch {
        // Not JSON, use as-is
      }
      return title.toLowerCase();
    }
    if (typeof title === "object" && title !== null) {
      return Object.values(title).join(" ").toLowerCase();
    }
    return "";
  }

  // Score each game by keyword matches
  let bestMatch: (typeof games)[0] | null = null;
  let bestScore = 0;

  for (const game of games) {
    const titleText = getTitleText(game.title);
    const cityText = (game.city || "").toLowerCase();
    const searchText = `${titleText} ${cityText}`;

    let score = 0;
    for (const kw of keywords) {
      if (searchText.includes(kw)) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = game;
    }
  }

  if (!bestMatch || bestScore === 0) {
    return NextResponse.json(
      { found: false, slug },
      { status: 404, headers: corsHeaders }
    );
  }

  return NextResponse.json(
    {
      found: true,
      gameId: bestMatch.id,
      title: extractTitle(bestMatch.title),
      city: bestMatch.city,
      slug,
    },
    { headers: corsHeaders }
  );
}
