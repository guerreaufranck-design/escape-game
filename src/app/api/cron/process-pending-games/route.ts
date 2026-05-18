/**
 * Cron : process-pending-games
 *
 * Filet de sécurité qui tourne CHAQUE MINUTE pour rattraper les jeux
 * coincés en `is_published=false` après l'insert par Lambda 1. Sans
 * ce cron, le fire-and-forget vers Lambda 2 (depuis /api/generate-game)
 * peut échouer silencieusement — observed Lugdunum V5 + Alcázar V1
 * 11-12/05 : Vercel kill Lambda 1 avant que la requête HTTP vers
 * Lambda 2 soit complètement envoyée, Lambda 2 n'est jamais déclenchée,
 * game reste éternellement `is_published=false`.
 *
 * Avec ce cron :
 *   Chaque minute → liste les games qui sont :
 *     - is_published=false
 *     - created_at < now() - 30s (laisse Lambda 1 finir tranquillement)
 *   Pour chaque, appelle finalizeGame() directement (synchrone côté cron).
 *
 * Idempotent : finalizeGame() skip les translations/audios déjà cachés.
 * Si Lambda 2 a déjà tourné partiellement, le cron continue d'où elle
 * s'est arrêtée. Plusieurs runs de cron peuvent être nécessaires pour
 * un gros jeu (chaque run a 10 min Vercel budget).
 *
 * Auth : Vercel signe les requests Cron avec CRON_SECRET header
 * (cf. https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * On vérifie l'auth pour éviter qu'un attaquant trigger les retries
 * coûteux à volonté.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeGame } from "@/lib/pipeline-finalize";
import { sendNeedsReviewAlert } from "@/lib/email";

export const maxDuration = 600;

// Cron path is GET per Vercel convention
export async function GET(request: NextRequest) {
  try {
    // Vercel Cron auth : header `authorization: Bearer ${CRON_SECRET}`
    // automatiquement injecté par Vercel quand le cron est triggeré.
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // En dev local sans CRON_SECRET configuré, on laisse passer pour
      // que les tests locaux marchent. En prod, CRON_SECRET DOIT être set.
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json(
          { error: "Unauthorized cron call" },
          { status: 401 },
        );
      }
    }

    const supabase = createAdminClient();

    // Find games stuck in is_published=false for > 5 minutes.
    // Why 5 min : Lambda 2 normale tourne 5-15 min typiquement. Si on
    // prend un cutoff plus court (e.g. 30s), on risque le cron qui
    // tourne PENDANT que Lambda 2 fait son travail → 2 finalizers en
    // parallèle pour le même game → race condition sur les Gemini calls
    // et l'audio gen.
    // 5 min est un compromis : Lambda 2 a un bon head start, et si après
    // 5 min ce n'est toujours pas publié, c'est probablement que Lambda 2
    // n'a jamais démarré (fire-and-forget failed) ou qu'elle a crashé.
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: stuckGames, error } = await supabase
      .from("games")
      .select("id, slug, city, title, transport_mode, created_at")
      .eq("is_published", false)
      // CRITICAL : skip games awaiting human review. They're not "stuck",
      // they're correctly flagged by validator and waiting for operator
      // action. Without this filter, the cron re-processes them every
      // minute forever, accumulating telemetry rows and re-running
      // prepareGamePackage uselessly. Observed 2026-05-18 on the Lille
      // test game : 396 telemetry rows in 3h, infinite loop.
      .eq("needs_review", false)
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(3); // process up to 3 per cron run (each takes 5-15 min)

    if (error) {
      console.error(`[cron/process-pending] DB query failed: ${error.message}`);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!stuckGames || stuckGames.length === 0) {
      console.log(`[cron/process-pending] No pending games found, exiting.`);
      return NextResponse.json({
        success: true,
        processed: 0,
      });
    }

    console.log(
      `[cron/process-pending] Found ${stuckGames.length} pending game(s) — processing...`,
    );

    // Process each game. Sequential because each can take 5-15 min,
    // and the cron has a 10-min budget total. If we hit the budget,
    // remaining games will be picked up by the next cron run.
    let processed = 0;
    let published = 0;
    let flagged = 0;
    const startedAt = Date.now();
    const BUDGET_MS = 9 * 60 * 1000; // 9 min, leave 1 min margin

    for (const game of stuckGames) {
      const elapsed = Date.now() - startedAt;
      if (elapsed > BUDGET_MS) {
        console.log(
          `[cron/process-pending] Budget exhausted (${Math.round(elapsed / 1000)}s), stopping. ${stuckGames.length - processed} remaining for next run.`,
        );
        break;
      }

      try {
        console.log(
          `[cron/process-pending] Processing ${game.slug} (id=${game.id}, age=${Math.round((Date.now() - new Date(game.created_at).getTime()) / 1000)}s)`,
        );
        // FinalizeGame is idempotent — skips cached audio/translations,
        // continues where left off. Even if Lambda 2 ran partially, we
        // can re-run safely.
        const result = await finalizeGame({
          gameId: game.id,
          language: "fr", // TODO: store language on game record to make this dynamic
          city: game.city,
          theme: game.title,
          narrative: "", // narrative not stored on game, but finalizeGame only needs it for auto-repair regenerateStep
          genre: undefined, // similar
        });
        processed++;
        if (result.isPublished) {
          published++;
          console.log(
            `[cron/process-pending] ✅ ${game.slug} → published (iter=${result.validatorIterations})`,
          );
        } else if (result.needsReview) {
          flagged++;
          console.log(
            `[cron/process-pending] ⚠ ${game.slug} → still flagged (iter=${result.validatorIterations})`,
          );
          // Send email alert ONCE per game (the alert is sent by
          // /api/internal/finalize-game already, but if this is the
          // 2nd+ cron run, we don't want to spam). Skip for now — the
          // first alert went out via Lambda 2 path or Lambda 1 path.
        }
      } catch (err) {
        console.error(
          `[cron/process-pending] ${game.slug} threw: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    console.log(
      `[cron/process-pending] Done. processed=${processed}, published=${published}, flagged=${flagged}, elapsed=${Math.round((Date.now() - startedAt) / 1000)}s`,
    );

    return NextResponse.json({
      success: true,
      processed,
      published,
      flagged,
      remaining: Math.max(0, stuckGames.length - processed),
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[cron/process-pending] Unexpected error:", errorMessage);
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 },
    );
  }
}
