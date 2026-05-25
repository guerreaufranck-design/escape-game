/**
 * Inngest function — buildGameV2.
 *
 * Remplace buildGameDurable (v1) pour les achats OddballTrip routés en v2.
 *
 * Flow :
 *   1. Insert games row vide avec is_published=false (pour avoir gameId)
 *   2. step.run("pipeline-v2") → runPipelineV2() qui fait tout
 *      (discover → geocode → structure → quality → persist → translate → audio)
 *   3. Flip is_published=true (sauf si needs_review=true)
 *   4. Create activation code
 *   5. Callback OddballTrip avec code
 *
 * Concurrency : 3 jeux en parallèle max (Perplexity rate limit + ElevenLabs).
 * Retry : 1 fois en cas de fail (Perplexity flaky).
 */

import { inngest, gameBuildRequested } from "@/lib/inngest-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPipelineV2 } from "@/lib/pipeline-v2/orchestrator";
import type { PipelineInput } from "@/lib/pipeline-v2/types";

function generateActivationCode(slug: string): string {
  const cityPart = slug.slice(0, 4).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const rand2 = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${cityPart}-${rand}-${rand2}`;
}

export const buildGameV2 = inngest.createFunction(
  {
    id: "build-game-v2",
    name: "v2 — Perplexity-first pipeline",
    triggers: [{ event: gameBuildRequested }],
    concurrency: { limit: 3 },
    retries: 1,
  },
  async ({ event, step, logger }) => {
    const data = event.data;
    logger.info(`[v2] start slug=${data.slug} city=${data.city} lang=${data.language ?? "fr"}`);

    // Guard v2 (2026-05-25) : V2 est désormais default. Skip UNIQUEMENT
    // si on demande v1 explicitement (legacy escape hatch).
    const wantsV1 = (event.data as { pipelineVersion?: string }).pipelineVersion === "v1"
      || process.env.PIPELINE_VERSION === "v1";
    if (wantsV1) {
      logger.info(`[v2] SKIP — pipelineVersion=v1 demandé explicitement`);
      return { skipped: true, reason: "v1_requested" };
    }

    const supabase = createAdminClient();

    // 1. Insert games row vide pour avoir un gameId
    const gameId = await step.run("insertEmptyGame", async () => {
      const { data: row, error } = await supabase
        .from("games")
        .insert({
          slug: data.slug,
          title: data.title || data.slug,
          description: "(pipeline v2 en cours)",
          city: data.city,
          difficulty: data.difficulty ?? 3,
          estimated_duration_min: data.estimatedDurationMin ?? 90,
          mode: data.mode ?? "city_game",
          transport_mode: data.transportMode ?? "walking",
          radius_km: data.radiusKm ?? null,
          is_published: false,
          needs_review: false,
          original_payload: data.originalPayload ?? {},
          product_description: data.productDescription ?? null,
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(`Insert games failed: ${error.message}`);
      return row.id as string;
    });
    logger.info(`[v2] insert game ok — id=${gameId}`);

    // 2. Run pipeline complet (orchestrator gère tout)
    const result = await step.run("pipeline-v2", async () => {
      const input: PipelineInput = {
        slug: data.slug,
        city: data.city,
        country: data.country,
        theme: data.title,
        themeDescription: data.themeDescription,
        productDescription: data.productDescription,
        narrative: data.narrative,
        buyerStops: (data.originalPayload as { stops?: PipelineInput["buyerStops"] })?.stops ?? undefined,
        startPoint: data.startPointLat && data.startPointLon
          ? { lat: data.startPointLat, lon: data.startPointLon }
          : undefined,
        startPointText: data.startPointText,
        language: (data.language ?? "fr").toLowerCase().slice(0, 2),
        transportMode: data.transportMode ?? "walking",
        radiusKm: data.radiusKm,
        genre: data.genre,
        mode: (data.mode ?? "city_game") as "city_game" | "city_tour",
        estimatedDurationMin: data.estimatedDurationMin ?? 90,
        difficulty: data.difficulty ?? 3,
        buyerEmail: data.buyerEmail,
        orderId: data.orderId,
        callbackUrl: data.callbackUrl,
        callbackSecret: data.callbackSecret,
        originalPayload: data.originalPayload ?? {},
      };
      // (2026-05-25, v3) L'orchestrator gère lui-même la traduction
      // EN → langue client. Aucune autre langue n'est générée
      // (mandat user : pas d'audio spéculatif).
      return await runPipelineV2(input, gameId, {
        skipAudio: false,
      });
    });

    // 3. Si needs_review → on s'arrête, pas de code, pas de callback
    if (result.needsReview) {
      logger.warn(`[v2] needs_review : ${result.reviewReason} — NO code, NO callback sent`);
      return {
        gameId,
        needsReview: true,
        reason: result.reviewReason,
        flags: result.qualityFlags,
      };
    }

    // 4. Flip is_published=true
    await step.run("publish", async () => {
      const { error } = await supabase
        .from("games")
        .update({ is_published: true, updated_at: new Date().toISOString() })
        .eq("id", gameId);
      if (error) throw new Error(`Publish failed: ${error.message}`);
    });

    // 5. Create activation code
    const code = await step.run("createCode", async () => {
      const codeStr = generateActivationCode(data.slug);
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      const { error } = await supabase.from("activation_codes").insert({
        code: codeStr,
        game_id: gameId,
        team_name: data.buyerEmail?.split("@")[0] ?? "Buyer",
        expires_at: expires.toISOString(),
        is_single_use: true,
        max_uses: 1,
      });
      if (error) throw new Error(`Code create failed: ${error.message}`);
      return codeStr;
    });
    logger.info(`[v2] code created : ${code}`);

    // 6. Callback OddballTrip
    if (data.callbackUrl && data.callbackSecret) {
      await step.run("callback", async () => {
        try {
          const res = await fetch(data.callbackUrl!, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${data.callbackSecret}`,
            },
            body: JSON.stringify({
              slug: data.slug,
              gameId,
              code,
              orderId: data.orderId,
              language: data.language,
            }),
          });
          if (!res.ok) {
            logger.warn(`[v2] callback non-2xx : ${res.status}`);
          }
        } catch (e) {
          logger.warn(`[v2] callback failed (non-blocking) : ${e instanceof Error ? e.message : "unknown"}`);
        }
      });
    }

    return {
      gameId,
      code,
      needsReview: false,
      stopCount: result.structure.stops.length,
      languages: [data.language, ...result.translations.map((t) => t.language)],
    };
  },
);
