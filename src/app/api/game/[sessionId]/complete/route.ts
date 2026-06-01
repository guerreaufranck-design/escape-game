import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateScore } from "@/lib/scoring";
import { t, detectLocale, isStaticLocale } from "@/lib/i18n";
import { translateStepFields, translateGameField } from "@/lib/translate-service";
import type { GameResults } from "@/types/game";

function getEnglishBase(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as Record<string, string>;
    return obj.en || obj.fr || Object.values(obj)[0] || "";
  }
  return String(value);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const locale = detectLocale(request);
    const supabase = createAdminClient();
    const needsTranslation = !isStaticLocale(locale);

    const { data: session, error: sessionError } = await supabase
      .from("game_sessions")
      .select("*, games(title, city, epilogue_title, epilogue_text)")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }

    if (session.current_step <= session.total_steps) {
      return NextResponse.json({ error: "Game not yet completed" }, { status: 400 });
    }

    const game = session.games as unknown as {
      title: string;
      city: string;
      epilogue_title?: unknown;
      epilogue_text?: unknown;
    };
    const now = new Date().toISOString();

    const { data: completions } = await supabase
      .from("step_completions")
      .select("*, game_steps(id, title, bonus_time_seconds, answer_text, anecdote)")
      .eq("session_id", sessionId)
      .order("step_order", { ascending: true });

    const totalTimeSeconds = Math.round(
      (new Date(now).getTime() - new Date(session.started_at).getTime()) / 1000
    );

    const totalPenalty = session.total_penalty_seconds;

    const bonusPoints = (completions || []).reduce((sum, c) => {
      const stepData = c.game_steps as unknown as { bonus_time_seconds: number } | null;
      return sum + (stepData?.bonus_time_seconds || 0);
    }, 0);

    const finalScore = calculateScore({
      totalTimeSeconds,
      totalPenaltySeconds: totalPenalty,
      bonusPoints,
    });

    if (session.status !== "completed") {
      await supabase
        .from("game_sessions")
        .update({
          status: "completed",
          completed_at: now,
          total_time_seconds: totalTimeSeconds,
          final_score: finalScore,
        })
        .eq("id", sessionId);

      // Notify OddballTrip that the game is finished, so the
      // review-email cron sends the "rate your adventure" email 24h
      // later. We only ping on the first transition to completed (this
      // branch) so a player reloading the results page doesn't trigger
      // duplicate calls — the OddballTrip endpoint is idempotent
      // anyway, but no point hitting it every reload.
      //
      // Lookup activation_code via activation_code_id (game_sessions
      // stores the FK, not the plain text code). Fire-and-forget : if
      // the ping fails, the player still sees the results page; the
      // worst that happens is no review email — better than the
      // alternative (asking for an avis to someone who didn't finish).
      try {
        const { data: codeRow } = await supabase
          .from("activation_codes")
          .select("code")
          .eq("id", session.activation_code_id)
          .single();

        const apiSecret = process.env.EXTERNAL_API_SECRET;
        if (codeRow?.code && apiSecret) {
          // Don't await — fire and forget so the player's results page
          // isn't slowed down by a network call to oddballtrip.com.
          //
          // Observabilité (2026-05-31) : on log AUSSI le succès pour
          // confirmer côté Vercel logs que le ping est bien parti et
          // qu'OddballTrip a accepté. Avant, .catch seul = succès
          // silencieux → impossible de vérifier sans demander à
          // OddballTrip côté leur DB.
          fetch("https://www.oddballtrip.com/api/external/game-finished", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiSecret}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ code: codeRow.code }),
          })
            .then(async (res) => {
              const body = await res.text().catch(() => "");
              if (res.ok) {
                console.log(
                  `[complete] game-finished ping OK for code=${codeRow.code} body=${body.slice(0, 200)}`,
                );
              } else {
                console.warn(
                  `[complete] game-finished ping FAILED status=${res.status} code=${codeRow.code} body=${body.slice(0, 200)}`,
                );
              }
            })
            .catch((err) => {
              console.warn("[complete] game-finished ping failed:", err);
            });
        } else {
          // Diagnostic explicite si une des 2 conditions manque — utile
          // pour identifier des bugs de config (EXTERNAL_API_SECRET non
          // set en prod, codeRow.code NULL...).
          console.warn(
            `[complete] game-finished SKIPPED — hasCode=${!!codeRow?.code} hasSecret=${!!apiSecret}`,
          );
        }
      } catch (err) {
        console.warn("[complete] game-finished lookup failed:", err);
      }
    }

    const { data: leaderboardEntry } = await supabase
      .from("leaderboard")
      .select("rank")
      .eq("session_id", sessionId)
      .single();

    const { count: totalPlayers } = await supabase
      .from("leaderboard")
      .select("*", { count: "exact", head: true })
      .eq("game_id", session.game_id);

    // Build step details with translations
    const steps = [];
    for (const c of completions || []) {
      const stepData = c.game_steps as unknown as {
        id: string;
        title: string;
        answer_text: unknown;
        anecdote: unknown;
      } | null;

      let title = t(stepData?.title, locale) || `Step ${c.step_order}`;
      let answer = stepData?.answer_text ? t(stepData.answer_text, locale) : null;
      let anecdote = stepData?.anecdote ? t(stepData.anecdote, locale) : null;

      // Cache lookup pour les step fields. Même fix que game-level :
      // `needsTranslation` (statique-locales-only) raterait les jeux
      // pipeline en EN brut + FR cache. On accepte aussi (locale != en
      // && isPlainEnglish) pour servir le cache FR existant.
      const stepIsPlain = typeof stepData?.title === "string" && !String(stepData.title).startsWith("{");
      const stepNeedsCache = needsTranslation || (locale !== "en" && stepIsPlain);
      if (stepNeedsCache && stepData?.id) {
        const enFields: Record<string, string> = {};
        const enTitle = getEnglishBase(stepData.title);
        const enAnswer = getEnglishBase(stepData.answer_text);
        const enAnecdote = getEnglishBase(stepData.anecdote);
        if (enTitle) enFields.title = enTitle;
        if (enAnswer) enFields.answer_text = enAnswer;
        if (enAnecdote) enFields.anecdote = enAnecdote;

        if (Object.keys(enFields).length > 0) {
          try {
            const translated = await translateStepFields(stepData.id, enFields, locale, { cacheOnly: true });
            if (translated.title) title = translated.title;
            if (translated.answer_text) answer = translated.answer_text;
            if (translated.anecdote) anecdote = translated.anecdote;
          } catch { /* keep fallback */ }
        }
      }

      steps.push({
        title,
        timeSeconds: c.time_seconds ?? 0,
        hintsUsed: c.hints_used,
        penaltySeconds: c.penalty_seconds,
        answer,
        anecdote,
      });
    }

    // BUG fix (Lugdunum V5 12/05) : la pipeline moderne stocke les
    // textes en EN brut dans `games` puis cache la traduction FR/etc
    // dans translations_cache via prepareGamePackage. Le check
    // `needsTranslation` (= !isStaticLocale) skip la lecture du cache
    // pour fr/de/es/it/en, supposant que ces langues sont déjà encodées
    // en JSON multi-lang dans la colonne. Faux pour la pipeline actuelle.
    //
    // Fix : aligner sur /api/game/[sessionId]/route.ts qui utilise
    // `needsGemini = needsTranslation || (locale !== "en" && isPlainEnglish)`.
    // Désormais on lit le cache même pour les locales statiques quand
    // le contenu DB est en EN brut.
    const isPlainEnglish = typeof game.title === "string" && !String(game.title).startsWith("{");
    const needsCacheLookup = needsTranslation || (locale !== "en" && isPlainEnglish);

    // Translate game title
    let gameTitle = t(game.title, locale);
    if (needsCacheLookup) {
      const enTitle = getEnglishBase(game.title);
      if (enTitle) {
        try {
          // cacheOnly: la pipeline garantit le cache complet via gate
          // is_published. Pas d'appel Gemini live ici (qui ferait
          // attendre la cliente).
          gameTitle = await translateGameField(session.game_id, "games", "title", enTitle, locale, { cacheOnly: true });
        } catch { /* keep fallback */ }
      }
    }

    // Translate epilogue (if the game has one)
    let epilogue: GameResults["epilogue"] = null;
    if (game.epilogue_title && game.epilogue_text) {
      let epilogueTitle = t(game.epilogue_title, locale) || getEnglishBase(game.epilogue_title);
      let epilogueText = t(game.epilogue_text, locale) || getEnglishBase(game.epilogue_text);

      if (needsCacheLookup) {
        const enTitle = getEnglishBase(game.epilogue_title);
        const enText = getEnglishBase(game.epilogue_text);
        try {
          if (enTitle) {
            epilogueTitle = await translateGameField(
              session.game_id,
              "games",
              "epilogue_title",
              enTitle,
              locale,
              { cacheOnly: true },
            );
          }
          if (enText) {
            epilogueText = await translateGameField(
              session.game_id,
              "games",
              "epilogue_text",
              enText,
              locale,
              { cacheOnly: true },
            );
          }
        } catch { /* keep English fallback */ }
      }

      if (epilogueTitle && epilogueText) {
        // BUG B FIX (2026-05-18) : fetch pre-generated MP3 URL for the
        // epilogue narration. The audio is stored in audio_cache at
        // step_order=0, slot='epilogue' for the player's locale.
        // Sans ça, GameEpilogue ne pouvait pas rendre de bouton "Écouter"
        // alors que l'audio existait bel et bien en DB.
        let epilogueAudioUrl: string | null = null;
        try {
          const { data: audioRow } = await supabase
            .from("audio_cache")
            .select("public_url")
            .eq("game_id", session.game_id)
            .eq("step_order", 0)
            .eq("slot", "epilogue")
            .eq("language", locale)
            .maybeSingle();
          epilogueAudioUrl = audioRow?.public_url ?? null;
        } catch {
          // best-effort — si l'audio manque, on continue sans
        }
        epilogue = {
          title: epilogueTitle,
          text: epilogueText,
          audioUrl: epilogueAudioUrl,
        };
      }
    }

    const results: GameResults = {
      sessionId: session.id,
      gameTitle,
      city: game.city,
      playerName: session.player_name,
      teamName: session.team_name,
      totalTimeSeconds,
      totalHintsUsed: session.total_hints_used,
      totalPenaltySeconds: totalPenalty,
      finalScore,
      rank: leaderboardEntry?.rank ?? 0,
      totalPlayers: totalPlayers ?? 0,
      steps,
      epilogue,
    };

    return NextResponse.json(results);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
