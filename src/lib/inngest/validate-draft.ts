/**
 * Inngest function — validateDraft v5
 *
 * Consume l'event `draft/validate.requested` émis par /api/admin/drafts.
 *
 * Utilise V5 modules (discover + geocode + select) au lieu de l'ancien
 * runSimpleDiscovery. Chaque module dans son propre step.run() Inngest →
 * pas de timeout Vercel, retry par étape.
 *
 * Sortie : game_drafts.stops avec les 5-8 landmarks sélectionnés par Claude,
 * dans l'ordre de parcours, GPS Google verified.
 */

import { inngest, draftValidateRequested } from "@/lib/inngest-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDiscover } from "@/lib/pipeline-v2/discover";
import { runGeocode } from "@/lib/pipeline-v2/geocode";
import { runSelect } from "@/lib/pipeline-v2/select";
import { CONFIG } from "@/lib/pipeline-v2/config";
import type { PipelineInput } from "@/lib/pipeline-v2/types";

export const validateDraft = inngest.createFunction(
  {
    id: "validate-draft",
    name: "Drafts v5 — Pre-validate landmarks (Perplexity sonar + Google + Claude select)",
    triggers: [{ event: draftValidateRequested }],
    concurrency: { limit: 5 },
    retries: 1,
  },
  async ({ event, step, logger }) => {
    const data = event.data;
    logger.info(`[validateDraft v5] start slug=${data.slug} city=${data.city}`);
    const supabase = createAdminClient();

    // Build minimal PipelineInput
    const transportMode: "walking" | "mixed" | "driving" =
      (data.transportMode as "walking" | "mixed" | "driving") ?? "walking";
    const radiusKm =
      typeof data.radiusKm === "number" && data.radiusKm > 0
        ? data.radiusKm
        : transportMode === "walking"
          ? CONFIG.WALKING_DEFAULT_RADIUS_KM
          : CONFIG.ROADTRIP_DEFAULT_RADIUS_KM;

    const input: PipelineInput = {
      slug: data.slug,
      city: data.city,
      country: data.country,
      theme: data.theme,
      themeDescription: data.themeDescription,
      productDescription: data.productDescription,
      startPoint: { lat: data.startPointLat, lon: data.startPointLon },
      language: "en", // drafts in EN (source), narration translated at sale time
      transportMode,
      radiusKm,
      genre: undefined,
      mode: "city_game",
      estimatedDurationMin: 90,
      difficulty: 3,
      originalPayload: data as unknown as Record<string, unknown>,
    };

    // ── STEP 1 : Discover (Perplexity sonar standard) ──
    let discovery;
    try {
      discovery = await step.run("discover", async () => {
        return await runDiscover(input);
      });
    } catch (e) {
      const reason = `discover échec : ${e instanceof Error ? e.message : "?"}`;
      logger.error(`[validateDraft] ${data.slug} ${reason}`);
      await supabase
        .from("game_drafts")
        .update({
          status: "pending",
          validation_error: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("slug", data.slug);
      throw new Error(reason);
    }

    // ── STEP 2 : Geocode (Google Places pur) ──
    const geocode = await step.run("geocode", async () => {
      return await runGeocode(input, discovery.landmarks);
    });

    if (geocode.geocoded.length < CONFIG.MIN_STOPS) {
      const reason = `Geocode : seulement ${geocode.geocoded.length} géocodés sur ${discovery.landmarks.length}`;
      logger.warn(`[validateDraft] ${data.slug} ${reason}`);
      await supabase
        .from("game_drafts")
        .update({
          status: "pending",
          validation_error: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("slug", data.slug);
      return { slug: data.slug, success: false, reason };
    }

    // ── STEP 3 : Select (Claude pick 8 best ordered) ──
    let selection;
    try {
      selection = await step.run("select", async () => {
        return await runSelect(input, geocode);
      });
    } catch (e) {
      const reason = `select échec : ${e instanceof Error ? e.message : "?"}`;
      logger.error(`[validateDraft] ${data.slug} ${reason}`);
      await supabase
        .from("game_drafts")
        .update({
          status: "pending",
          validation_error: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("slug", data.slug);
      throw new Error(reason);
    }

    if (selection.selected.length < CONFIG.MIN_STOPS) {
      const reason = `Select : seulement ${selection.selected.length} landmarks sélectionnés (min ${CONFIG.MIN_STOPS})`;
      logger.warn(`[validateDraft] ${data.slug} ${reason}`);
      await supabase
        .from("game_drafts")
        .update({
          status: "pending",
          validation_error: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("slug", data.slug);
      return { slug: data.slug, success: false, reason };
    }

    // ── STEP 4 : Persist le draft validated ──
    await step.run("persist-draft", async () => {
      const stops = selection.selected.map((s, i) => ({
        step_order: i + 1,
        name: s.googleName || s.name,
        description: s.narrativeTitle ?? "",
        lat: s.lat,
        lon: s.lon,
        placeId: s.placeId,
        distanceFromStartM: s.distanceFromStartM,
        types: s.placeTypes,
        // V5 fields (legacy V1 fields left null for compat)
        themeScore: null,
        tier: null,
        rationale: s.narrativeTitle ?? null,
        realFigure: null,
        realEvent: null,
        rating: null,
      }));

      const diagnostics = {
        pipelineVersion: "v5",
        discoverLandmarks: discovery.landmarks.length,
        geocoded: geocode.geocoded.length,
        geocodeFailed: geocode.failed.length,
        selected: selection.selected.length,
        editorialWarning: discovery.warning ?? null,
        selectionRationale: selection.rationale,
        citationsCount: discovery.citations.length,
      };

      await supabase
        .from("game_drafts")
        .update({
          status: "validated",
          stops,
          diagnostics,
          validated_at: new Date().toISOString(),
          validation_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("slug", data.slug);

      logger.info(
        `[validateDraft v5] ${data.slug} VALIDATED : ${stops.length} stops (${discovery.landmarks.length} candidats → ${geocode.geocoded.length} géocodés → ${selection.selected.length} sélectionnés)`,
      );
    });

    return {
      slug: data.slug,
      success: true,
      stops: selection.selected.length,
    };
  },
);
