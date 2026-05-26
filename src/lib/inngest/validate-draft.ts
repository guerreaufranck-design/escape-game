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
import { runGeocode, geocodeStartPoint } from "@/lib/pipeline-v2/geocode";
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

    // Détection GPS valide vs texte seul (cf. input.ts shouldResolveStartFromText)
    const hasValidGps =
      typeof data.startPointLat === "number" &&
      typeof data.startPointLon === "number" &&
      !(data.startPointLat === 0 && data.startPointLon === 0);
    const hasText =
      typeof data.startPointText === "string" && data.startPointText.trim().length > 0;
    if (!hasValidGps && !hasText) {
      const reason = `startPoint missing : payload doit fournir SOIT startPointLat/Lon, SOIT startPointText`;
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

    const input: PipelineInput = {
      slug: data.slug,
      city: data.city,
      country: data.country,
      theme: data.theme,
      themeDescription: data.themeDescription,
      productDescription: data.productDescription,
      startPoint: hasValidGps
        ? { lat: data.startPointLat as number, lon: data.startPointLon as number }
        : { lat: 0, lon: 0 }, // placeholder, résolu par resolve-start
      startPointText: data.startPointText,
      language: "en", // drafts in EN (source), narration translated at sale time
      transportMode,
      radiusKm,
      genre: undefined,
      mode: "city_game",
      estimatedDurationMin: 90,
      difficulty: 3,
      originalPayload: data as unknown as Record<string, unknown>,
    };

    // ── STEP 0.5 : Resolve start point + force as stop 1 ──
    // Règle (2026-05-26) : si le payload contient un startPointText non vide,
    // on l'utilise TOUJOURS pour résoudre le start point ET le forcer comme
    // stop 1 — peu importe si GPS aussi présent (l'admin/drafts pré-géocode
    // mais on veut quand même la cohérence buyer-text = stop1).
    //
    // Si pas de texte → mode legacy : on utilise le GPS tel quel, pas de
    // forced start (Claude libre de choisir l'ordre).
    let forcedStartLandmark: Awaited<ReturnType<typeof geocodeStartPoint>> = null;
    if (hasText) {
      forcedStartLandmark = await step.run("resolve-start", async () => {
        return await geocodeStartPoint(data.startPointText as string, data.city);
      });
      if (!forcedStartLandmark) {
        const reason = `resolve-start échec : Google Places n'a pas trouvé "${data.startPointText}" dans ${data.city}`;
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
      // Override input.startPoint avec les coords Google (même si admin/drafts
      // avait pré-résolu — Google est plus fiable que les coords passées).
      input.startPoint = { lat: forcedStartLandmark.lat, lon: forcedStartLandmark.lon };
      logger.info(
        `[validateDraft] ${data.slug} startPoint résolu : ${forcedStartLandmark.googleName} @ ${forcedStartLandmark.lat},${forcedStartLandmark.lon}`,
      );
    }

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

    // ── STEP 2 : Geocode (Google Places pur) + injection forced start ──
    const geocode = await step.run("geocode", async () => {
      return await runGeocode(input, discovery.landmarks, forcedStartLandmark);
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

      // Mandat 2026-05-26 : start_point persisté = stops[0] (le joueur
      // PWA verra "votre point de départ" cohérent avec le stop 1).
      const stop1 = stops[0];
      await supabase
        .from("game_drafts")
        .update({
          status: "validated",
          stops,
          diagnostics,
          start_point_lat: stop1?.lat ?? null,
          start_point_lon: stop1?.lon ?? null,
          start_point_text: stop1?.name ?? data.startPointText ?? null,
          validated_at: new Date().toISOString(),
          validation_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("slug", data.slug);

      logger.info(
        `[validateDraft v5] ${data.slug} VALIDATED : ${stops.length} stops (${discovery.landmarks.length} candidats → ${geocode.geocoded.length} géocodés → ${selection.selected.length} sélectionnés) — start_point=stop1="${stop1?.name}"`,
      );
    });

    return {
      slug: data.slug,
      success: true,
      stops: selection.selected.length,
    };
  },
);
