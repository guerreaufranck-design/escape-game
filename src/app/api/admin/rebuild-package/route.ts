/**
 * POST /api/admin/rebuild-package
 *
 * Ré-émet `game/generate.requested` pour un jeu EXISTANT afin de
 * reconstruire les artefacts post-insert (translations + audio + validator
 * + publish), SANS callback OddballTrip et SANS toucher au gameId / aux
 * codes d'activation.
 *
 * Cas d'usage typique : patch manuel d'un stop existant (cf. Aegina
 * 2026-05-17 où Stops 1+5 ont été remplacés par Markellos Tower / Temple
 * of Aphaia). Après patch DB + wipe des entries `translations_cache` /
 * `audio_cache` correspondantes, on appelle cet endpoint pour que la
 * pipeline Inngest remplisse les blancs.
 *
 * Idempotence : `buildGamePackage` (cf. game-package.ts) skip les slots
 * audio_cache déjà présents, donc l'event ne refait que ce qui manque.
 * Pareil pour translations_cache. Donc safe à appeler N fois.
 *
 * Auth : Bearer EXTERNAL_API_SECRET (CLI) OU admin session cookie (UI).
 *
 * Body : { gameId: string }
 *   (slug/city/theme sont retrouvés depuis la DB)
 *
 * Réponse : { ok: true, gameId, slug, eventSent: true }
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { validateApiKey } from "@/lib/external-auth";
import { inngest } from "@/lib/inngest-client";

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

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    if (!(await isAuthorized(request))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { gameId?: string; language?: string };
    if (!body.gameId) {
      return NextResponse.json({ error: "gameId required" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: game, error } = await supabase
      .from("games")
      .select("id, slug, city, title, description")
      .eq("id", body.gameId)
      .single();

    if (error || !game) {
      return NextResponse.json(
        { error: `Game not found: ${body.gameId}` },
        { status: 404 },
      );
    }

    // Mêmes champs que heartbeat.ts (line 110-122). Pas de callbackUrl
    // → la pipeline ne notifie pas OddballTrip à nouveau.
    await inngest.send({
      name: "game/generate.requested",
      data: {
        gameId: game.id,
        slug: game.slug ?? "",
        language: body.language ?? "fr",
        city: game.city ?? "",
        theme: game.title,
        narrative: game.description ?? "",
      },
    });

    return NextResponse.json({
      ok: true,
      gameId: game.id,
      slug: game.slug,
      eventSent: true,
      message:
        "Event game/generate.requested emitted. Pipeline Inngest fills missing translations + audio (idempotent). No OddballTrip callback.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `rebuild-package failed: ${msg}` },
      { status: 500 },
    );
  }
}
