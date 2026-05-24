/**
 * Inngest function — validateDraft.
 *
 * Consume l'event `draft/validate.requested` émis par /api/admin/drafts.
 *
 * Run runSimpleDiscovery() en background (peut prendre 5-10 min avec
 * Perplexity deep-research, donc Vercel timeout 300s impossible en sync).
 *
 * À la fin :
 *   - Si succès : update draft status='validated' + stops + diagnostics
 *   - Si fail : update draft validation_error + status reste 'pending'
 *   - Retry Perplexity 1 fois si retourne 0 landmarks (Versailles bug)
 */
import { inngest, draftValidateRequested } from "@/lib/inngest-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSimpleDiscovery } from "@/lib/pipeline-simple";

export const validateDraft = inngest.createFunction(
  {
    id: "validate-draft",
    name: "Drafts — Pre-validate landmarks via runSimpleDiscovery",
    triggers: [{ event: draftValidateRequested }],
    concurrency: { limit: 5 }, // 5 drafts en parallèle max
    retries: 1,
  },
  async ({ event, step, logger }) => {
    const data = event.data;
    logger.info(`[validateDraft] start slug=${data.slug} city=${data.city}`);
    const supabase = createAdminClient();

    // Step 1 — run discovery (with retry on Perplexity 0)
    const result = await step.run("runSimpleDiscovery", async () => {
      const walkingRadiusM =
        data.transportMode === "driving" || data.transportMode === "mixed"
          ? Math.round((data.radiusKm ?? 30) * 1000)
          : undefined;

      let sr = await runSimpleDiscovery({
        city: data.city,
        country: data.country,
        theme: data.theme,
        themeDescription: data.themeDescription,
        productDescription: data.productDescription,
        startPoint: { lat: data.startPointLat, lon: data.startPointLon },
        targetStopCount: data.targetStopCount,
        minStopCount: 5,
        walkingRadiusM,
      });

      const proposedZero = sr.diagnostics?.notes?.some(
        (n) => n.includes("proposed 0 landmarks") || n.includes("Claude proposed 0"),
      );
      if (proposedZero) {
        logger.info(`[validateDraft] Perplexity returned 0 for ${data.slug}, retrying once`);
        sr = await runSimpleDiscovery({
          city: data.city,
          country: data.country,
          theme: data.theme,
          themeDescription: data.themeDescription,
          productDescription: data.productDescription,
          startPoint: { lat: data.startPointLat, lon: data.startPointLon },
          targetStopCount: data.targetStopCount,
          minStopCount: 5,
          walkingRadiusM,
        });
      }
      return sr;
    });

    // Step 2 — update draft in DB
    await step.run("updateDraft", async () => {
      if (!result.success || (result.stops?.length ?? 0) < 5) {
        await supabase
          .from("game_drafts")
          .update({
            status: "pending",
            validation_error:
              result.errorMessage ?? `only ${result.stops?.length ?? 0} stops`,
            diagnostics: result.diagnostics,
            updated_at: new Date().toISOString(),
          })
          .eq("slug", data.slug);
        logger.warn(
          `[validateDraft] ${data.slug} FAILED : ${result.errorMessage ?? "insufficient stops"}`,
        );
        return;
      }

      // Adapt stops to the exact shape needed at fulfill time
      const cleanStops = result.stops.map((s, i) => ({
        step_order: i + 1,
        name: s.name,
        description: s.description ?? "",
        lat: s.lat,
        lon: s.lon,
        placeId: s.placeId,
        distanceFromStartM: s.distanceFromStartM,
        types: s.types,
        rating: s.rating,
        themeScore: s.themeScore,
        tier: s.tier,
        rationale: s.rationale,
        realFigure: s.realFigure,
        realEvent: s.realEvent,
      }));

      await supabase
        .from("game_drafts")
        .update({
          status: "validated",
          stops: cleanStops,
          diagnostics: result.diagnostics,
          validated_at: new Date().toISOString(),
          validation_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("slug", data.slug);

      logger.info(
        `[validateDraft] ${data.slug} VALIDATED : avg=${result.diagnostics.averageScore} T1=${result.diagnostics.tier1Count} T2=${result.diagnostics.tier2Count}`,
      );
    });

    return { slug: data.slug, success: result.success };
  },
);
