import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { detectLocale, isStaticLocale } from "@/lib/i18n";
import { translateStepFields, translateGameField } from "@/lib/translate-service";

/**
 * Pull the English base text out of a translation map ({en, fr, …}) or a
 * plain string. Used everywhere we need to feed Gemini the source language.
 */
function getEnglishBase(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const o = value as Record<string, string>;
    return o.en || o.fr || Object.values(o).find(Boolean) || "";
  }
  return String(value);
}

/**
 * POST /api/game/[sessionId]/start
 * Starts the game timer. Transitions session from 'pending' to 'active'.
 * Called when the player clicks "Let's go!" after reading the briefing.
 *
 * Side-effect: pre-warms the translation cache for ALL steps + epilogue
 * in parallel. Without this, the player would hit "EN flash" on every
 * step transition because Gemini would translate just-in-time. Now the
 * cache is full before they leave the briefing screen, so all subsequent
 * loads come from Supabase cache (no Gemini call → instant).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const locale = detectLocale(request);
    const supabase = createAdminClient();

    // Fetch session
    const { data: session, error: sessionError } = await supabase
      .from("game_sessions")
      .select("id, status, started_at, game_id")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Session introuvable" },
        { status: 404 }
      );
    }

    // Already started — return current started_at (idempotent)
    if (session.started_at) {
      // Still kick off prefetch in the background — useful if the player
      // changes locale between visits.
      void prefetchTranslations(supabase, session.game_id, locale).catch(() => {});
      return NextResponse.json({
        success: true,
        startedAt: session.started_at,
      });
    }

    // Only pending sessions can be started
    if (session.status !== "pending") {
      return NextResponse.json(
        { error: "La session ne peut pas etre demarree" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("game_sessions")
      .update({
        status: "active",
        started_at: now,
      })
      .eq("id", sessionId);

    if (updateError) {
      return NextResponse.json(
        { error: "Erreur lors du demarrage" },
        { status: 500 }
      );
    }

    // Pre-warm the translation cache. We don't await this — the player
    // shouldn't wait for Gemini before the timer starts. Errors are
    // swallowed (already logged inside) since the runtime fallback
    // re-translates lazily when needed.
    void prefetchTranslations(supabase, session.game_id, locale).catch((err) => {
      console.warn(
        `[start/${sessionId}] prefetch translations failed silently. err=${err instanceof Error ? err.message : err}`,
      );
    });

    return NextResponse.json({
      success: true,
      startedAt: now,
    });
  } catch {
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}

/**
 * Translate (and cache) every text field the player will see across the
 * whole game, in parallel. After this returns, every other endpoint that
 * looks up a translation will get a cache hit and skip Gemini.
 *
 * Hard timeout per field: 4s. If Gemini is slow we don't block the start
 * endpoint forever — partial cache is still better than empty cache.
 */
async function prefetchTranslations(
  supabase: ReturnType<typeof createAdminClient>,
  gameId: string,
  locale: string,
): Promise<void> {
  if (locale === "en") return;

  // Game-level fields
  const { data: game } = await supabase
    .from("games")
    .select("id, title, description, epilogue_title, epilogue_text")
    .eq("id", gameId)
    .single();

  // Per-step fields
  const { data: steps } = await supabase
    .from("game_steps")
    .select(
      "id, title, riddle_text, anecdote, answer_text, ar_character_dialogue, ar_treasure_reward",
    )
    .eq("game_id", gameId)
    .order("step_order", { ascending: true });

  const tasks: Array<Promise<unknown>> = [];

  // Helper: turn a translation into a 4s-bounded promise that never throws.
  const safe = <T,>(p: Promise<T>): Promise<T | null> =>
    Promise.race<T | null>([
      p.catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);

  if (game) {
    const enTitle = getEnglishBase(game.title);
    const enDesc = getEnglishBase(game.description);
    const enEpiTitle = getEnglishBase(game.epilogue_title);
    const enEpiText = getEnglishBase(game.epilogue_text);

    if (enTitle)
      tasks.push(
        safe(translateGameField(game.id, "games", "title", enTitle, locale)),
      );
    if (enDesc)
      tasks.push(
        safe(
          translateGameField(game.id, "games", "description", enDesc, locale),
        ),
      );
    if (enEpiTitle)
      tasks.push(
        safe(
          translateGameField(
            game.id,
            "games",
            "epilogue_title",
            enEpiTitle,
            locale,
          ),
        ),
      );
    if (enEpiText)
      tasks.push(
        safe(
          translateGameField(
            game.id,
            "games",
            "epilogue_text",
            enEpiText,
            locale,
          ),
        ),
      );
  }

  // For each step, queue ALL text fields into a single Gemini call.
  if (!isStaticLocale(locale) || locale !== "en") {
    for (const step of steps || []) {
      const enFields: Record<string, string> = {};
      const t = getEnglishBase(step.title);
      const r = getEnglishBase(step.riddle_text);
      const a = getEnglishBase(step.anecdote);
      const ans = getEnglishBase(step.answer_text);
      if (t) enFields.title = t;
      if (r) enFields.riddle_text = r;
      if (a) enFields.anecdote = a;
      if (ans) enFields.answer_text = ans;
      if (Object.keys(enFields).length > 0) {
        tasks.push(safe(translateStepFields(step.id, enFields, locale)));
      }

      // AR per-step fields use translateGameField (no batching since
      // they're tiny — single sentences).
      if (step.ar_character_dialogue) {
        tasks.push(
          safe(
            translateGameField(
              step.id,
              "game_steps",
              "ar_character_dialogue",
              step.ar_character_dialogue,
              locale,
            ),
          ),
        );
      }
      if (step.ar_treasure_reward) {
        tasks.push(
          safe(
            translateGameField(
              step.id,
              "game_steps",
              "ar_treasure_reward",
              step.ar_treasure_reward,
              locale,
            ),
          ),
        );
      }
    }
  }

  await Promise.all(tasks);
  console.log(
    `[start/${gameId}] prefetched ${tasks.length} translations for locale=${locale}`,
  );
}
