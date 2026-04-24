import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { obfuscateCoordinates } from "@/lib/geo";
import { t, detectLocale, isStaticLocale } from "@/lib/i18n";
import { translateStepFields, translateGameField } from "@/lib/translate-service";
import type { GameState, CompletedStepInfo, Hint } from "@/types/game";

/**
 * Resolve a multilingual field: extract English base text from JSONB or plain string.
 */
function getEnglishBase(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") {
    // Handle JSON-stringified objects like '{"fr":"...","en":"..."}'
    if (value.startsWith("{") && value.includes('"')) {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === "object" && parsed !== null) {
          return parsed.en || parsed.fr || Object.values(parsed)[0] || value;
        }
      } catch { /* not JSON */ }
    }
    return value;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, string>;
    return obj.en || obj.fr || Object.values(obj)[0] || "";
  }
  return String(value);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const locale = detectLocale(request);
    const supabase = createAdminClient();
    const needsTranslation = !isStaticLocale(locale);

    // Fetch session with game data
    const { data: session, error: sessionError } = await supabase
      .from("game_sessions")
      .select("*, games(*)")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Session introuvable" },
        { status: 404 }
      );
    }

    const game = session.games as unknown as {
      id: string;
      title: string;
      description: string | null;
      intro_videos: Record<string, string> | null;
      estimated_duration_min: number | null;
      max_hints_per_step: number;
    };

    // Translate game title & description
    let gameTitle = t(game.title, locale);
    let gameDescription = t(game.description, locale);

    // Check if translation is needed:
    // - non-static locale (e.g. Chinese, Russian) always needs Gemini
    // - static locale != 'en' also needs Gemini when content is plain English (pipeline-generated games)
    const isPlainEnglish = typeof game.title === "string" && !String(game.title).startsWith("{");
    const needsGemini = needsTranslation || (locale !== "en" && isPlainEnglish);

    if (needsGemini) {
      const enTitle = getEnglishBase(game.title);
      const enDesc = getEnglishBase(game.description);
      [gameTitle, gameDescription] = await Promise.all([
        enTitle ? translateGameField(game.id, "games", "title", enTitle, locale) : Promise.resolve(""),
        enDesc ? translateGameField(game.id, "games", "description", enDesc, locale) : Promise.resolve(""),
      ]);
    }

    // Fetch current step data if game is active
    let currentRiddle: GameState["currentRiddle"] = null;
    let arHistoricalPhoto: GameState["arHistoricalPhoto"] = null;
    let arFacadeText: GameState["arFacadeText"] = null;
    let arTreasureReward: GameState["arTreasureReward"] = null;
    let arCharacter: GameState["arCharacter"] = null;
    let approximateTarget: GameState["approximateTarget"] = null;
    let validationRadius = 30;
    let hintsAvailable = 0;
    let currentStepId: string | null = null;

    if ((session.status === "active" || session.status === "pending") && session.current_step <= session.total_steps) {
      const { data: step } = await supabase
        .from("game_steps")
        .select("*")
        .eq("game_id", session.game_id)
        .eq("step_order", session.current_step)
        .single();

      if (step) {
        currentStepId = step.id;

        const stepIsPlainEnglish = typeof step.title === "string" && !String(step.title).startsWith("{");
        const stepNeedsGemini = needsTranslation || (locale !== "en" && stepIsPlainEnglish);

        const answerSource: "physical" | "virtual_ar" =
          step.answer_source === "virtual_ar" ? "virtual_ar" : "physical";

        if (stepNeedsGemini) {
          // Translate step fields via Gemini + cache
          const enFields: Record<string, string> = {
            title: getEnglishBase(step.title),
            riddle_text: getEnglishBase(step.riddle_text),
          };
          const translated = await translateStepFields(step.id, enFields, locale);
          currentRiddle = {
            title: translated.title || enFields.title,
            text: translated.riddle_text || enFields.riddle_text,
            image: step.riddle_image,
            hasPhotoChallenge: step.has_photo_challenge,
            answerSource,
          };
        } else {
          currentRiddle = {
            title: t(step.title, locale),
            text: t(step.riddle_text, locale),
            image: step.riddle_image,
            hasPhotoChallenge: step.has_photo_challenge,
            answerSource,
          };
        }

        approximateTarget = obfuscateCoordinates(step.latitude, step.longitude);
        validationRadius = step.validation_radius_meters;

        if (step.ar_historical_photo_url) {
          arHistoricalPhoto = {
            url: step.ar_historical_photo_url,
            credit: step.ar_historical_photo_credit || null,
          };
        }

        const hints = (step.hints as unknown as Hint[]) || [];
        hintsAvailable = hints.length;

        // AR facade text:
        //  - virtual_ar steps: the facade text IS the answer, materialised
        //    magically when the player locks on. This is the ONLY way to
        //    discover the answer for these steps.
        //  - physical steps: fall back to admin-set hint, or hint #2 (where
        //    to look), so the magical overlay guides the player toward the
        //    real inscription they need to read.
        arFacadeText =
          answerSource === "virtual_ar"
            ? step.answer_text || step.ar_facade_text || null
            : step.ar_facade_text || hints[1]?.text || null;
        arTreasureReward = step.ar_treasure_reward || null;

        // AR character: if any dialogue is set (or fallback to atmospheric
        // hint #1 so it works out-of-the-box), pick a character type based
        // on what the admin set, defaulting to a generic "guardian".
        const charDialogue = step.ar_character_dialogue || hints[0]?.text || null;
        if (charDialogue) {
          arCharacter = {
            type: step.ar_character_type || "default",
            dialogue: charDialogue,
          };
        }
      }
    }

    // Fetch completed steps
    const { data: completions } = await supabase
      .from("step_completions")
      .select("step_order, time_seconds, hints_used")
      .eq("session_id", sessionId)
      .order("step_order", { ascending: true });

    const completedSteps: CompletedStepInfo[] = [];
    if (completions && completions.length > 0) {
      const { data: steps } = await supabase
        .from("game_steps")
        .select("step_order, title")
        .eq("game_id", session.game_id)
        .in("step_order", completions.map((c) => c.step_order));

      const stepTitleMap = new Map(
        (steps || []).map((s) => [s.step_order, s.title])
      );

      for (const completion of completions) {
        const rawTitle = stepTitleMap.get(completion.step_order);
        let title = t(rawTitle, locale) || `Step ${completion.step_order}`;

        const completedStepIsPlain = typeof rawTitle === "string" && !String(rawTitle).startsWith("{");
        if ((needsTranslation || (locale !== "en" && completedStepIsPlain)) && rawTitle) {
          const enTitle = getEnglishBase(rawTitle);
          if (enTitle) {
            try {
              title = await translateGameField(
                `step-title-${session.game_id}-${completion.step_order}`,
                "game_steps", "completed_title", enTitle, locale
              );
            } catch {
              // Keep fallback
            }
          }
        }

        completedSteps.push({
          stepOrder: completion.step_order,
          title,
          timeSeconds: completion.time_seconds ?? 0,
          hintsUsed: completion.hints_used,
        });
      }
    }

    // Get intro video URL
    let introVideoUrl: string | null = null;
    if (game.intro_videos) {
      introVideoUrl = game.intro_videos[locale] || game.intro_videos.fr || game.intro_videos.en || Object.values(game.intro_videos)[0] || null;
    }

    const gameState: GameState = {
      sessionId: session.id,
      gameId: session.game_id,
      gameTitle,
      gameDescription,
      introVideoUrl,
      estimatedDuration: game.estimated_duration_min ? `${Math.floor(game.estimated_duration_min / 60)}h${String(game.estimated_duration_min % 60).padStart(2, "0")}` : null,
      playerName: session.player_name || "Player",
      currentStep: session.current_step,
      currentStepId,
      totalSteps: session.total_steps,
      status: session.status,
      startedAt: session.started_at,
      currentRiddle,
      arHistoricalPhoto,
      arFacadeText,
      arTreasureReward,
      arCharacter,
      approximateTarget,
      validationRadius,
      navigationHint: null,
      hintsAvailable,
      hintsUsed: session.total_hints_used,
      completedSteps,
    };

    return NextResponse.json(gameState);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
