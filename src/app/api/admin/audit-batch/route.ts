/**
 * POST /api/admin/audit-batch
 *
 * Tourne validateFinalGame() sur TOUS les jeux existants en DB (ou un
 * filtre fourni) et retourne un rapport agrégé : combien de jeux passent,
 * lesquels ont des issues, quel type d'issue domine.
 *
 * Cas d'usage :
 *   - C5 : audit qualité périodique pour spotter les jeux pré-cdf95c6
 *     (pré-fix GPS structurel) qui ont potentiellement des GPS pourris.
 *     Permet de proactivement régénérer / patcher avant qu'un client
 *     se plaigne.
 *   - C6 : retroactif post-fix — après chaque commit qui ajoute un
 *     nouveau quality gate, on peut auditer le legacy pour voir combien
 *     de jeux seraient maintenant flaggés.
 *
 * Auth : Bearer EXTERNAL_API_SECRET OU admin session.
 *
 * Body (optionnel) :
 *   { since?: ISO8601, limit?: number, onlyPublished?: boolean }
 *
 * Réponse :
 *   {
 *     ok: true,
 *     scanned: number,
 *     healthy: number,
 *     issues: {
 *       [issueCode]: { count, gameIds: string[] }
 *     },
 *     details: Array<{ gameId, slug, title, issueCodes, reviewReason }>
 *     durationMs: number
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { validateApiKey } from "@/lib/external-auth";
import { validateFinalGame } from "@/lib/pipeline-validators";

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (validateApiKey(request)) return true;
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const admin = createAdminClient();
    const { data: adminRow } = await admin
      .from("admin_users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    return Boolean(adminRow);
  } catch {
    return false;
  }
}

// Vercel Pro : jusqu'à 800s. Audit batch peut prendre du temps si
// beaucoup de jeux (chaque validateFinalGame fait des appels DB + 8
// Google geocode pour cross-validation).
export const maxDuration = 800;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();

  let body: { since?: string; limit?: number; onlyPublished?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // empty body OK
  }

  const supabase = createAdminClient();
  let query = supabase
    .from("games")
    .select("id, slug, title, is_published, created_at")
    .order("created_at", { ascending: false });

  if (body.since) {
    query = query.gte("created_at", body.since);
  }
  if (body.onlyPublished !== false) {
    // Default : only published games (most relevant for customer-facing
    // quality). Pass `onlyPublished: false` to scan unpublished too.
    query = query.eq("is_published", true);
  }
  if (body.limit && body.limit > 0) {
    query = query.limit(body.limit);
  } else {
    query = query.limit(200); // safety cap, prevent unbounded scan
  }

  const { data: games, error: fetchErr } = await query;
  if (fetchErr) {
    return NextResponse.json(
      { error: `Failed to fetch games: ${fetchErr.message}` },
      { status: 500 },
    );
  }
  if (!games || games.length === 0) {
    return NextResponse.json({
      ok: true,
      scanned: 0,
      healthy: 0,
      issues: {},
      details: [],
      durationMs: Date.now() - t0,
    });
  }

  // Run validators in parallel (with a cap to avoid Google rate-limit).
  // 4 concurrent is conservative.
  const CONCURRENCY = 4;
  const results: Array<{
    gameId: string;
    slug: string | null;
    title: string;
    issueCodes: string[];
    reviewReason: string;
  }> = [];

  for (let i = 0; i < games.length; i += CONCURRENCY) {
    const batch = games.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (g) => {
        const validation = await validateFinalGame(g.id, undefined);
        return {
          gameId: g.id,
          slug: g.slug,
          title: g.title,
          issueCodes: validation.issues.map((iss) => iss.code),
          reviewReason: validation.reviewReason,
        };
      }),
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      }
    }
  }

  // Aggregate stats
  const issueAgg: Record<string, { count: number; gameIds: string[] }> = {};
  let healthy = 0;
  for (const r of results) {
    if (r.issueCodes.length === 0) {
      healthy++;
    } else {
      for (const code of r.issueCodes) {
        if (!issueAgg[code]) issueAgg[code] = { count: 0, gameIds: [] };
        issueAgg[code].count++;
        issueAgg[code].gameIds.push(r.gameId);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: results.length,
    healthy,
    issues: issueAgg,
    // Only return details for games WITH issues — keeps response small
    details: results.filter((r) => r.issueCodes.length > 0),
    durationMs: Date.now() - t0,
  });
}
