/**
 * Game Generation Pipeline
 * Orchestrates: Perplexity (research) → Claude (creation) → Supabase (storage)
 *
 * Two modes:
 * 1. Predefined: Game designer provides stops from oddballtrip → Perplexity researches facts → Claude creates riddles
 * 2. Discovery: Only city/theme provided → Perplexity finds locations AND facts → Claude creates riddles
 */

import {
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
import { geocodeLocation } from "./geocode";
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
  /**
   * GPS-FIRST MODE — operator clicks N pins on a satellite map and
   * provides their exact coords + landmark names. When this field is
   * set, the research + geocoding phases are SKIPPED entirely; the
   * pins are taken at face value as the ground-truth coordinates of
   * the game. This is the only mode that guarantees < 10 m precision
   * (LLMs hallucinate coords by 50-2 800 m on average).
   *
   * Each waypoint's `lat`/`lon` is stored verbatim in
   * `game_steps.latitude/longitude`. Each `landmarkName` is stored in
   * `game_steps.landmark_name` (hidden from players, used by audit /
   * re-geocoding tools). Claude only writes the poetic title + riddle
   * + AR answer, never touches the coord.
   */
  waypoints?: GameWaypoint[];
}

export interface GameWaypoint {
  /** Latitude as clicked by the operator on the satellite map. */
  lat: number;
  /** Longitude as clicked by the operator on the satellite map. */
  lon: number;
  /** The real landmark name ("Abbaye Saint-Philibert"). Stored in DB
   *  as `landmark_name` for audit. NEVER shown to players. */
  landmarkName: string;
  /** Optional context to help Claude write the riddle (e.g.
   *  "the carved pediment above the main door", "8th-c. crypt"). */
  context?: string;
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
    // STEP 1: GPS-first geocoding of every operator-provided stop
    // ============================================
    // The legacy LLM-research-first flow (Perplexity + Claude) routinely
    // produced coordinates that drifted by 50-2 800 m from the real
    // landmark they described — a 34% / 32% / 34% split of OK / WARNING /
    // CRITICAL across the existing 11 games. Validation radius is 25-50 m,
    // so anything past that = player physically arrives but the app says
    // "you're not there yet".
    //
    // The new contract: oddballtrip.com sends a `stops[]` array where each
    // stop carries an OPTIONAL `landmarkName` field — the real, geocoder-
    // friendly name ("Abbaye Saint-Philibert, Tournus"). We use that to
    // fetch authoritative GPS via Google Places (sub-10 m on named
    // landmarks), Nominatim as fallback. The coords we get are LOCKED:
    // Claude is never allowed to paraphrase, round, or invent them.
    //
    // If a stop has no `landmarkName`, we fall back to its `name`. If
    // both fail to geocode, the pipeline rejects the whole game with a
    // clear error — better fail-loud than ship a broken radar to a
    // paying customer.
    if (!template.stops || template.stops.length === 0) {
      throw new Error(
        "GPS_FIRST_REQUIRED: pipeline now requires `stops[]` from oddballtrip. Discovery mode is deprecated — generation cannot proceed without operator-provided landmark names.",
      );
    }

    console.log(
      `[Pipeline] Step 1: Geocoding ${template.stops.length} stops directly (GPS-first mode)...`,
    );
    const researchStart = Date.now();

    const verifiedLocations: ResearchedLocation[] = [];
    const geocodeFailures: Array<{ stopName: string; tried: string[] }> = [];

    for (const stop of template.stops) {
      const queryName = stop.landmarkName?.trim() || stop.name.trim();
      const tried = [queryName];
      let geo = await geocodeLocation(
        queryName,
        template.city,
        template.country,
      );
      // If we used `landmarkName` and it failed, give the poetic `name`
      // a single second chance — it might still happen to be a real
      // place ("Iglesia del Carmen" works even without "landmarkName").
      if (!geo && stop.landmarkName && stop.landmarkName.trim() !== stop.name.trim()) {
        tried.push(stop.name.trim());
        geo = await geocodeLocation(
          stop.name,
          template.city,
          template.country,
        );
      }
      if (!geo) {
        geocodeFailures.push({ stopName: stop.name, tried });
        continue;
      }
      console.log(
        `[Pipeline] geocoded "${queryName}" → ${geo.lat.toFixed(6)},${geo.lon.toFixed(6)} (source=${geo.source}, confidence=${geo.confidence})`,
      );
      verifiedLocations.push({
        name: stop.name,
        landmarkName: stop.landmarkName?.trim() || queryName,
        latitude: geo.lat,
        longitude: geo.lon,
        // Description from operator becomes the "what to observe"
        // hint Claude uses to anchor the riddle. Fallback wording
        // works for any virtual_ar step.
        whatToObserve:
          stop.description?.trim() ||
          `Look around ${stop.name} — the AR camera will reveal the answer.`,
        // "AUTO" = Claude must invent the AR answer (a year, a Latin
        // word, a Roman numeral) at narrative time. Distinct from the
        // legacy "UNVERIFIED" flag so we can tell the cases apart in
        // logs / diagnostics.
        answer: "AUTO",
        answerType: "name",
        answerSource: "virtual_ar",
        source: "operator-provided",
        themeLink: "",
      });
    }

    if (geocodeFailures.length > 0) {
      const failureSummary = geocodeFailures
        .map(
          (f) =>
            `  - "${f.stopName}" (tried: ${f.tried.map((s) => `"${s}"`).join(", ")})`,
        )
        .join("\n");
      throw new Error(
        `GEOCODING_FAILED: ${geocodeFailures.length} stop(s) could not be geocoded via Google Places nor Nominatim:\n${failureSummary}\n\nFix the landmarkName for these stops on oddballtrip and regenerate.`,
      );
    }

    const researchDurationMs = Date.now() - researchStart;
    console.log(
      `[Pipeline] All ${verifiedLocations.length} stops geocoded in ${Math.round(researchDurationMs / 1000)}s — coords are LOCKED for the rest of the pipeline`,
    );

    const physicalCount = verifiedLocations.filter(
      (l) => l.answerSource === "physical",
    ).length;
    const virtualCount = verifiedLocations.length - physicalCount;
    console.log(
      `[Pipeline] ${verifiedLocations.length} locations: ${physicalCount} physical, ${virtualCount} virtual_ar`,
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
    const gameId = await insertGameIntoDatabase(template, steps, stepPhotos, epilogue, verifiedLocations);
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
  epilogue: GeneratedEpilogue | null = null,
  // Indexed by step_order - 1. Carries the locked-in geocoded
  // coordinates and the real landmark name for each step. Required by
  // the GPS-first flow: we copy lat/lon from here verbatim into the DB
  // and never trust whatever Claude returned for that field.
  verifiedLocations: ResearchedLocation[] = [],
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
    // 3 cheap hints per step is the sweet spot: hint 1 = atmospheric
    // nudge, hint 2 = where to look (e.g. "scan the facade above the
    // main door"), hint 3 = the SHAPE of the answer ("a Latin word + a
    // century in Roman numerals"). Without #2 and #3 the player has no
    // way to guess they should open the AR camera, which is exactly
    // what blocked Forest+Philippat in Tournus.
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

  /**
   * Normalize hints into the canonical [{order, text}] shape.
   *
   * Magali's first-customer purchase tonight surfaced a silent failure
   * mode: Claude sometimes returned hints as plain strings ("hint
   * text 1", "hint text 2") instead of {order, text} objects. The
   * previous .map(h => ({order: h.order, text: h.text})) produced
   * [{}, {}, {}] in that case — DB stored empty objects, the player
   * unlocked hints and saw nothing, then skipped the step. So we
   * accept BOTH shapes here and re-derive the order from the array
   * index when the model omitted it.
   */
  function normalizeHints(
    raw: unknown,
  ): Array<{ order: number; text: string }> {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((h, i) => {
        if (typeof h === "string") return { order: i + 1, text: h };
        if (h && typeof h === "object") {
          const obj = h as { order?: number; text?: string };
          const text = String(obj.text ?? "").trim();
          if (!text) return null;
          return { order: obj.order ?? i + 1, text };
        }
        return null;
      })
      .filter((h): h is { order: number; text: string } => h !== null);
  }

  // Insert steps
  const stepsToInsert = steps.map((step, index) => {
    const hints = normalizeHints(step.hints as unknown);
    if (hints.length < 3) {
      // Hard fail rather than silently shipping a step the player can't
      // get unstuck on. AR-locked steps need the full 3-hint ladder
      // (atmosphere → where to look → shape of the answer) — without it,
      // a player whose AR doesn't render perfectly has no way forward.
      // The throw surfaces in the pipeline failure email so we know to
      // re-prompt Claude rather than ship a broken game.
      throw new Error(
        `Step ${index + 1} has only ${hints.length} hint(s), need >= 3. Raw: ${JSON.stringify(step.hints).slice(0, 200)}`,
      );
    }

    // Coords sanity check — refuse to publish a step with missing or
    // null-island coordinates. The Shibuya game shipped to two real
    // customers with 5 of 8 steps at lat=0 lon=0 (Claude couldn't
    // resolve some of the fictional venues from the Lucie Blackman case
    // and the pipeline silently inserted zeros). Without this guard
    // those players' radar pointed at the middle of the Atlantic.
    //
    // Special-case: the Royal Observatory in Greenwich is literally on
    // the prime meridian, so lon == 0 with lat ≈ 51.477 is legitimate.
    // The check stays narrow on purpose — anywhere else, lat=0 OR lon=0
    // means the data is broken.
    const lat = Number(step.latitude);
    const lon = Number(step.longitude);
    const isPrimeMeridianGreenwich =
      lon === 0 && Number.isFinite(lat) && lat >= 51.45 && lat <= 51.5;
    const coordsLookBroken =
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      (!isPrimeMeridianGreenwich && (lat === 0 || lon === 0));
    if (coordsLookBroken) {
      throw new Error(
        `Step ${index + 1} ("${typeof step.title === "string" ? step.title : JSON.stringify(step.title)}") has invalid GPS coordinates lat=${step.latitude} lon=${step.longitude} — refusing to publish a game whose radar would point at the middle of the ocean. Re-prompt Claude with explicit GPS for every stop.`,
      );
    }

    // Keep up to 3 hints (Claude is asked for exactly 3). We used to
    // trim to 1 to match a previous max_hints_per_step=1 default, which
    // wasted the hints we'd already paid Claude to generate AND made
    // AR-locked games unrecoverable when the player couldn't see the
    // facade text.
    const trimmedHints = hints.slice(0, 3);

    // CRITICAL: enforce ar_facade_text === answer_text in uppercase.
    // Claude has a strong creative bias toward decorating the facade
    // text ("ANNO DOMINI 1189" instead of "1189", "TRES DOMINI" instead
    // of "III"). With AR auto-validate sending arFacadeText to the
    // server for comparison against answer_text, ANY decoration breaks
    // validation server-side and the player gets stuck. The prompt
    // says MUST EXACTLY match but Claude ignored it on the Agen test
    // game (5/8 steps mismatched). We override here, server-side, so
    // it can NEVER happen again regardless of what the model said.
    const enforcedFacade = step.answer_text
      ? String(step.answer_text).toUpperCase()
      : step.ar_facade_text || null;

    // Pull the locked-in real landmark name from the verified
    // location list, indexed by step order. This is what gets stored
    // in `game_steps.landmark_name` — used by audit / re-geocoding
    // tools, NEVER exposed to the player.
    const sourceLocation = verifiedLocations[index];
    const landmarkName =
      sourceLocation?.landmarkName?.trim() || sourceLocation?.name || null;

    return {
      id: uuidv4(),
      game_id: gameId,
      step_order: index + 1,
      title: step.title,
      landmark_name: landmarkName,
      riddle_text: step.riddle_text,
      answer_text: step.answer_text,
      // Coords are taken VERBATIM from the geocoded source — Claude is
      // never allowed to override them at this stage. If anything
      // looks off here, the bug is upstream in the geocoder, not in
      // Claude.
      latitude: sourceLocation?.latitude ?? step.latitude,
      longitude: sourceLocation?.longitude ?? step.longitude,
      validation_radius_meters: step.validation_radius_meters,
      hints: trimmedHints,
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
      ar_facade_text: enforcedFacade,
      ar_treasure_reward: step.ar_treasure_reward || null,
      // Route POIs — defensive normalization (drop entries missing
      // name or fact, cap at 3). We log a warning when a step has 0
      // entries so the post-generation alert email surfaces the gap;
      // we don't hard-fail (legacy games would break) but the next
      // attractions-fill script can pick up the slack.
      route_attractions: (() => {
        const valid = Array.isArray(step.route_attractions)
          ? step.route_attractions
              .filter(
                (a): a is { name: string; fact: string } =>
                  !!a &&
                  typeof a === "object" &&
                  typeof (a as { name?: unknown }).name === "string" &&
                  typeof (a as { fact?: unknown }).fact === "string" &&
                  (a as { name: string }).name.trim().length > 0 &&
                  (a as { fact: string }).fact.trim().length > 0,
              )
              .slice(0, 3)
          : [];
        if (valid.length === 0) {
          console.warn(
            `[Pipeline] Step ${index + 1} has NO route_attractions — UI card will be hidden. Consider re-running fill-step1-attractions or similar.`,
          );
        }
        return valid;
      })(),
    };
  });

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
