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
} from "./perplexity";
import { generateGameSteps } from "./anthropic";
import { createAdminClient } from "./supabase/admin";
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

    // Filter out UNVERIFIED locations
    const verifiedLocations = locations.filter(
      (l) => l.answer !== "UNVERIFIED"
    );
    const minRequired = Math.max(8, template.stops?.length || 8);
    if (verifiedLocations.length < minRequired) {
      throw new Error(
        `Only ${verifiedLocations.length} verified locations (need ${minRequired}). Unverified: ${locations.filter((l) => l.answer === "UNVERIFIED").map((l) => l.name).join(", ")}`
      );
    }
    console.log(
      `[Pipeline] ${verifiedLocations.length} verified, ${locations.length - verifiedLocations.length} unverified`
    );

    // ============================================
    // STEP 2: Create riddles with Claude
    // ============================================
    console.log("[Pipeline] Step 2: Creating riddles with Claude...");
    const creationStart = Date.now();

    const steps = await generateGameSteps(
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
    // STEP 3: Insert into Supabase
    // ============================================
    console.log("[Pipeline] Step 3: Inserting into Supabase...");
    const gameId = await insertGameIntoDatabase(template, steps);
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
 * Insert a generated game and its steps into Supabase
 */
async function insertGameIntoDatabase(
  template: GameTemplate,
  steps: Awaited<ReturnType<typeof generateGameSteps>>
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
