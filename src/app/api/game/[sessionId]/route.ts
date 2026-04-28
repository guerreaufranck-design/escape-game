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
      // If Gemini is down, fall back to English so the API never 500s on
      // the player. Cached translations are unaffected.
      const enTitle = getEnglishBase(game.title);
      const enDesc = getEnglishBase(game.description);
      const safeTranslate = (
        field: string,
        en: string,
      ): Promise<string> =>
        en
          ? translateGameField(game.id, "games", field, en, locale).catch(
              (err) => {
                console.warn(
                  `[game] ${field} translation failed, serving English. err=${err instanceof Error ? err.message : err}`,
                );
                return en;
              },
            )
          : Promise.resolve("");
      [gameTitle, gameDescription] = await Promise.all([
        safeTranslate("title", enTitle),
        safeTranslate("description", enDesc),
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
          // Translate step fields via Gemini + cache. If Gemini is down or
          // throws, never let the player see a 500 — fall back to the raw
          // English content so the game stays playable. Cached translations
          // (when available) come straight from Supabase and are unaffected.
          const enFields: Record<string, string> = {
            title: getEnglishBase(step.title),
            riddle_text: getEnglishBase(step.riddle_text),
          };
          let translated: Record<string, string> = {};
          try {
            translated = await translateStepFields(step.id, enFields, locale);
          } catch (err) {
            console.warn(
              `[game/${sessionId}] step translation failed, serving English. Locale=${locale}, step=${step.id}, err=${err instanceof Error ? err.message : err}`,
            );
          }
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

        // Pre-warm hint translation in the background. The player will tap
        // the hint button at most once per step, but their wait then is
        // a Gemini round-trip (2-6s of perceived latency). By kicking the
        // translation off here while they're walking, the cache is hot
        // by the time they unlock the hint — instant reveal. Fire-and-
        // forget; errors are swallowed (the hint endpoint will retry).
        if (locale !== "en" && hints[0]?.text) {
          const hintEn = typeof hints[0].text === "object"
            ? (hints[0].text as Record<string, string>).en ||
              (hints[0].text as Record<string, string>).fr ||
              Object.values(hints[0].text as Record<string, string>)[0] ||
              ""
            : String(hints[0].text);
          if (hintEn) {
            void translateGameField(
              `hint-${session.game_id}-${session.current_step}-0`,
              "game_steps",
              "hint_text",
              hintEn,
              locale,
            ).catch(() => {});
          }
        }

        // AR facade text:
        //  - virtual_ar steps: the facade text IS the answer, materialised
        //    magically when the player locks on. This is the ONLY way to
        //    discover the answer for these steps. Never translated — it's
        //    the literal answer the player must type.
        //  - physical steps: short evocative word(s), often Latin/Spanish
        //    by design — also kept untranslated for atmosphere.
        arFacadeText =
          answerSource === "virtual_ar"
            ? step.answer_text || step.ar_facade_text || null
            : step.ar_facade_text || hints[1]?.text || null;

        // AR treasure reward — full English sentence; needs translation
        // when the player picked a non-English locale.
        const rawTreasure = step.ar_treasure_reward || null;
        if (rawTreasure) {
          if (locale !== "en") {
            try {
              arTreasureReward = await translateGameField(
                step.id,
                "game_steps",
                "ar_treasure_reward",
                rawTreasure,
                locale,
              );
            } catch {
              arTreasureReward = rawTreasure;
            }
          } else {
            arTreasureReward = rawTreasure;
          }
        }

        // AR character: if any dialogue is set (or fallback to atmospheric
        // hint #1 so it works out-of-the-box), pick a character type based
        // on what Claude set, defaulting to a generic "default" guide.
        const rawDialogue = step.ar_character_dialogue || hints[0]?.text || null;
        if (rawDialogue) {
          let dialogue = rawDialogue;
          if (locale !== "en") {
            try {
              dialogue = await translateGameField(
                step.id,
                "game_steps",
                "ar_character_dialogue",
                rawDialogue,
                locale,
              );
            } catch {
              dialogue = rawDialogue;
            }
          }
          arCharacter = {
            type: step.ar_character_type || "default",
            dialogue,
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
