/**
 * Game Generation Pipeline
 * Orchestrates: Perplexity (research) → Claude (creation) → Supabase (storage)
 *
 * Two modes:
 * 1. Predefined: Game designer provides stops from oddballtrip → Perplexity researches facts → Claude creates riddles
 * 2. Discovery: Only city/theme provided → Perplexity finds locations AND facts → Claude creates riddles
 */

import {
  researchPredefinedStops,
  researchGameLocations,
  type PredefinedStop,
  type ResearchedLocation,
} from "./perplexity";
import {
  generateGameSteps,
  generateEpilogue,
  validateGeneratedSteps,
  regenerateStep,
  type GeneratedEpilogue,
  type GeneratedStep,
} from "./anthropic";
import { createAdminClient } from "./supabase/admin";
import { fetchHistoricalPhoto, type HistoricalPhotoResult } from "./wikipedia";
import { v4 as uuidv4 } from "uuid";

export interface GameTemplate {
  slug: string;
  city: string;
  country: string;
  theme: string;
  themeDescription: string;
  narrative: string;
  difficulty: number; // 1-5
  estimatedDurationMin: number;
  coverImage?: string;
  /** Predefined stops from oddballtrip — if provided, Perplexity only researches these */
  stops?: PredefinedStop[];
}

export interface PipelineResult {
  success: boolean;
  gameId?: string;
  error?: string;
  durationMs?: number;
  steps?: number;
  researchDurationMs?: number;
  creationDurationMs?: number;
}

/**
 * Generate a complete game from a template
 * This is the main pipeline entry point
 */
export async function generateGameFromTemplate(
  template: GameTemplate
): Promise<PipelineResult> {
  const startTime = Date.now();

  try {
    console.log(
      `[Pipeline] Starting game generation for ${template.city} - "${template.theme}"`
    );
    if (template.stops?.length) {
      console.log(
        `[Pipeline] Mode: PREDEFINED (${template.stops.length} stops from oddballtrip)`
      );
    } else {
      console.log("[Pipeline] Mode: DISCOVERY (finding locations from scratch)");
    }

    // ============================================
    // STEP 1: Research with Perplexity Deep Research
    // ============================================
    console.log("[Pipeline] Step 1: Researching locations with Perplexity...");
    const researchStart = Date.now();

    let locations;
    if (template.stops && template.stops.length > 0) {
      // Mode 1: Research predefined stops from oddballtrip
      locations = await researchPredefinedStops(
        template.city,
        template.country,
        template.theme,
        template.stops
      );
    } else {
      // Mode 2: Discover locations from scratch
      locations = await researchGameLocations(
        template.city,
        template.country,
        template.theme,
        template.themeDescription
      );
    }

    const researchDurationMs = Date.now() - researchStart;
    console.log(
      `[Pipeline] Found ${locations.length} locations in ${Math.round(researchDurationMs / 1000)}s`
    );

    // No more UNVERIFIED filtering: Claude extraction now always returns a
    // concrete answer (physical OR virtual_ar). The pipeline only fails if the
    // number of extracted locations is lower than expected (i.e. Claude
    // dropped some entries entirely, which is a real extraction bug).
    //
    // Legacy safety net: if for any reason an entry still has "UNVERIFIED",
    // we promote it to virtual_ar with a fallback answer rather than drop it.
    const normalizedLocations = locations.map((l) => {
      if (l.answer === "UNVERIFIED" || !l.answer) {
        return {
          ...l,
          answer: "III", // fallback virtual answer (Roman 3, works for most themes)
          answerType: "number" as const,
          answerSource: "virtual_ar" as const,
          whatToObserve:
            "Point your camera at the facade in AR mode — the answer will appear painted on the wall.",
        };
      }
      return {
        ...l,
        answerSource: l.answerSource ?? ("physical" as const),
      };
    });

    const minRequired = template.stops?.length ?? 8;
    if (normalizedLocations.length < minRequired) {
      throw new Error(
        `Only ${normalizedLocations.length} locations extracted (need ${minRequired}). Claude extraction dropped entries.`,
      );
    }
    const verifiedLocations = normalizedLocations;
    const physicalCount = normalizedLocations.filter(
      (l) => l.answerSource === "physical",
    ).length;
    const virtualCount = normalizedLocations.length - physicalCount;
    console.log(
      `[Pipeline] ${normalizedLocations.length} locations: ${physicalCount} physical, ${virtualCount} virtual_ar`,
    );

    // ============================================
    // STEP 2: Create riddles with Claude
    // ============================================
    console.log("[Pipeline] Step 2: Creating riddles with Claude...");
    const creationStart = Date.now();

    let steps: GeneratedStep[] = await generateGameSteps(
      template.city,
      template.country,
      template.theme,
      template.narrative,
      template.difficulty,
      verifiedLocations
    );

    const creationDurationMs = Date.now() - creationStart;
    console.log(
      `[Pipeline] Generated ${steps.length} game steps in ${Math.round(creationDurationMs / 1000)}s`
    );

    // ============================================
    // STEP 2.5: Walking-route safety check (warn-only)
    // ============================================
    // Verify the player won't have to cross a multi-lane road or take a
    // long detour between consecutive stops. We don't block generation
    // on this — surfacing it in logs is enough to flag manually until we
    // wire automated reordering. Field-test feedback prompted this.
    try {
      const { checkWalkingRoute } = await import("./route-safety");
      const route = await checkWalkingRoute(
        steps.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
      );
      console.log(
        `[Pipeline] Route safety: total straight ${route.totalStraightM}m, walking ${route.totalWalkingM ?? "n/a"}m, allOk=${route.allOk}`,
      );
      route.legs.forEach((leg, i) => {
        if (!leg.ok) {
          console.warn(
            `[Pipeline] ⚠ Leg ${i + 1}→${i + 2}: straight=${leg.straightDistanceM}m walking=${leg.walkingDistanceM ?? "?"}m ratio=${leg.detourRatio ?? "?"} — ${leg.reasons.join("; ")}`,
          );
        }
      });
    } catch (err) {
      console.warn(
        `[Pipeline] Route safety check failed (non-blocking): ${err instanceof Error ? err.message : err}`,
      );
    }

    // ============================================
    // STEP 2bis: Validation + auto-correction (Claude #2)
    // ============================================
    // A second Claude call critiques the generated steps. If it flags real
    // problems (too-easy answers, broken riddles, factual errors), we
    // regenerate the offending step(s). Max 2 retries to bound the cost.
    console.log("[Pipeline] Step 2bis: Validating with Claude reviewer...");
    const validationStart = Date.now();

    for (let attempt = 1; attempt <= 2; attempt++) {
      const validation = await validateGeneratedSteps({
        steps,
        city: template.city,
        theme: template.theme,
        narrative: template.narrative,
      });

      if (validation.ok || validation.issues.length === 0) {
        console.log(`[Pipeline] Validation OK on attempt ${attempt}`);
        break;
      }

      // Only regenerate steps with major or blocking issues — minor are accepted
      const blockingIssues = validation.issues.filter(
        (i) => i.severity === "major" || i.severity === "blocking",
      );

      if (blockingIssues.length === 0) {
        console.log(
          `[Pipeline] Validation found ${validation.issues.length} minor issue(s), accepting as-is`,
        );
        break;
      }

      console.log(
        `[Pipeline] Validation flagged ${blockingIssues.length} step(s) on attempt ${attempt}: ${blockingIssues
          .map((i) => `step ${i.step_index + 1} (${i.severity})`)
          .join(", ")}`,
      );

      if (attempt === 2) {
        // After 2 attempts, ship as-is rather than block delivery
        console.warn(
          `[Pipeline] Validation still failing after 2 attempts — shipping as-is. Admin should review.`,
        );
        break;
      }

      // Regenerate each flagged step
      for (const issue of blockingIssues) {
        const idx = issue.step_index;
        if (idx < 0 || idx >= steps.length) continue;
        // Find the matching source location (same coordinates)
        const stepLat = steps[idx].latitude;
        const stepLon = steps[idx].longitude;
        const sourceLoc =
          verifiedLocations.find(
            (l) =>
              Math.abs(l.latitude - stepLat) < 0.0001 &&
              Math.abs(l.longitude - stepLon) < 0.0001,
          ) || verifiedLocations[idx];
        if (!sourceLoc) continue;

        try {
          steps[idx] = await regenerateStep({
            brokenStep: steps[idx],
            issue,
            location: sourceLoc,
            city: template.city,
            theme: template.theme,
            narrative: template.narrative,
            stepNumber: idx + 1,
            totalSteps: steps.length,
          });
          console.log(`[Pipeline]   ↳ regenerated step ${idx + 1}`);
        } catch (err) {
          console.warn(
            `[Pipeline]   ↳ regeneration failed for step ${idx + 1}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    console.log(
      `[Pipeline] Validation completed in ${Math.round((Date.now() - validationStart) / 1000)}s`,
    );

    // ============================================
    // STEP 2b: Fetch Wikipedia historical photos for AR overlay
    // ============================================
    console.log("[Pipeline] Step 2b: Fetching historical photos from Wikipedia...");
    const photoStart = Date.now();
    const stepPhotos = await fetchPhotosForSteps(steps, verifiedLocations, template.city);
    console.log(
      `[Pipeline] Got ${stepPhotos.filter((p) => p !== null).length}/${steps.length} photos in ${Math.round((Date.now() - photoStart) / 1000)}s`
    );

    // ============================================
    // STEP 2c: Generate narrative epilogue (Claude)
    // ============================================
    console.log("[Pipeline] Step 2c: Generating narrative epilogue...");
    const epilogueStart = Date.now();
    let epilogue: GeneratedEpilogue | null = null;
    try {
      epilogue = await generateEpilogue({
        city: template.city,
        country: template.country,
        theme: template.theme,
        narrative: template.narrative,
        difficulty: template.difficulty,
        steps,
      });
      console.log(
        `[Pipeline] Epilogue generated ("${epilogue.title}", ${epilogue.text.length} chars) in ${Math.round((Date.now() - epilogueStart) / 1000)}s`,
      );
    } catch (err) {
      // Non-blocking: if epilogue generation fails, the game still ships.
      // The results page will just show a fallback message.
      console.warn(
        `[Pipeline] Epilogue generation failed, continuing without it: ${err instanceof Error ? err.message : err}`,
      );
    }

    // ============================================
    // STEP 3: Insert into Supabase
    // ============================================
    console.log("[Pipeline] Step 3: Inserting into Supabase...");
    const gameId = await insertGameIntoDatabase(template, steps, stepPhotos, epilogue);
    console.log(`[Pipeline] Game created with ID: ${gameId}`);

    const durationMs = Date.now() - startTime;
    console.log(
      `[Pipeline] Complete in ${Math.round(durationMs / 1000)}s`
    );

    return {
      success: true,
      gameId,
      durationMs,
      steps: steps.length,
      researchDurationMs,
      creationDurationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(
      `[Pipeline] Failed after ${Math.round(durationMs / 1000)}s: ${errorMessage}`
    );

    return {
      success: false,
      error: errorMessage,
      durationMs,
    };
  }
}

/**
 * Match each generated step to its source location by GPS proximity, then
 * fetch a Wikipedia historical photo for that location. Runs in parallel.
 * Returns one entry per step (null if no photo found).
 */
async function fetchPhotosForSteps(
  steps: Awaited<ReturnType<typeof generateGameSteps>>,
  locations: ResearchedLocation[],
  city: string,
): Promise<(HistoricalPhotoResult | null)[]> {
  // Distance in metres between two GPS points (fast equirectangular approx)
  const distance = (a: [number, number], b: [number, number]) => {
    const R = 6371000;
    const dLat = ((b[0] - a[0]) * Math.PI) / 180;
    const dLon = ((b[1] - a[1]) * Math.PI) / 180;
    const lat1 = (a[0] * Math.PI) / 180;
    const lat2 = (b[0] * Math.PI) / 180;
    const x = dLon * Math.cos((lat1 + lat2) / 2);
    return R * Math.sqrt(x * x + dLat * dLat);
  };

  // For each step, find the nearest source location (usually <20m)
  const queries = steps.map((step) => {
    let best: ResearchedLocation | null = null;
    let bestDist = Infinity;
    for (const loc of locations) {
      const d = distance([step.latitude, step.longitude], [loc.latitude, loc.longitude]);
      if (d < bestDist) {
        bestDist = d;
        best = loc;
      }
    }
    return best ? best.name : step.title;
  });

  return Promise.all(queries.map((name) => fetchHistoricalPhoto(name, city)));
}

/**
 * Insert a generated game and its steps into Supabase
 */
async function insertGameIntoDatabase(
  template: GameTemplate,
  steps: Awaited<ReturnType<typeof generateGameSteps>>,
  stepPhotos: (HistoricalPhotoResult | null)[] = [],
  epilogue: GeneratedEpilogue | null = null
): Promise<string> {
  const supabase = createAdminClient();
  const gameId = uuidv4();

  // Insert game (English only — translated on demand by the app)
  const { error: gameError } = await supabase.from("games").insert({
    id: gameId,
    slug: template.slug,
    title: template.theme,
    description: template.themeDescription,
    city: template.city,
    difficulty: template.difficulty,
    estimated_duration_min: template.estimatedDurationMin,
    is_published: true, // Auto-published — generated games are ready to play
    max_hints_per_step: 3,
    hint_penalty_seconds: 30,
    cover_image: template.coverImage || null,
    // Narrative epilogue (English only here — translated on demand like other fields)
    epilogue_title: epilogue?.title ?? null,
    epilogue_text: epilogue?.text ?? null,
  });

  if (gameError) {
    throw new Error(`Failed to insert game: ${gameError.message}`);
  }

  // Insert steps
  const stepsToInsert = steps.map((step, index) => ({
    id: uuidv4(),
    game_id: gameId,
    step_order: index + 1,
    title: step.title,
    riddle_text: step.riddle_text,
    answer_text: step.answer_text,
    latitude: step.latitude,
    longitude: step.longitude,
    validation_radius_meters: step.validation_radius_meters,
    hints: step.hints.map((h) => ({
      order: h.order,
      text: h.text,
    })),
    anecdote: step.anecdote,
    bonus_time_seconds: step.bonus_time_seconds,
    has_photo_challenge: false,
    ar_historical_photo_url: stepPhotos[index]?.url || null,
    ar_historical_photo_credit: stepPhotos[index]?.credit || null,
    // AR-first flow: every step is virtual_ar regardless of what the
    // model returned. The "physical" mode is fully retired.
    answer_source: "virtual_ar" as const,
    // AR runtime layer — populated by Claude during generation
    ar_character_type: step.ar_character_type || "default",
    ar_character_dialogue: step.ar_character_dialogue || null,
    ar_facade_text: step.ar_facade_text || null,
    ar_treasure_reward: step.ar_treasure_reward || null,
  }));

  const { error: stepsError } = await supabase
    .from("game_steps")
    .insert(stepsToInsert);

  if (stepsError) {
    // Rollback: delete the game if steps fail
    await supabase.from("games").delete().eq("id", gameId);
    throw new Error(`Failed to insert steps: ${stepsError.message}`);
  }

  return gameId;
}
