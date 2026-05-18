/**
 * Game package preparation: text translation + audio generation
 * for a (game × language) pair.
 *
 * Called by /api/external/generate-code when a customer purchases a
 * code with a chosen language. Pre-warms the cache so the player
 * has zero loading at activation:
 *   - All voiceable texts (character dialogue, anecdote, epilogue)
 *     are translated and cached in translations_cache
 *   - All voiceable texts get a corresponding ElevenLabs MP3 in
 *     audio_cache + Supabase Storage
 *
 * Idempotent: if a (game × language × slot) row already exists in
 * audio_cache, that slot is skipped.
 *
 * Synchronous on purpose. Caller decides whether to await (to send
 * email after) or fire-and-forget (Vercel might cut off — see notes
 * in the API route).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { translateGameField, translateStepFields, translateUIStrings } from "@/lib/translate-service";
import { generateAndStoreAudio, buildAudioPath } from "@/lib/elevenlabs";
import { voiceFor } from "@/lib/voice-map";
import { t, isStaticLocale } from "@/lib/i18n";
import { logTelemetry } from "@/lib/pipeline-telemetry";
import { ui } from "@/lib/translations";

export interface PackageResult {
  success: boolean;
  gameId: string;
  language: string;
  audioGenerated: number;
  audioSkipped: number;
  audioFailed: number;
  durationMs: number;
  errors: string[];
}

interface AudioJob {
  stepOrder: number;
  slot:
    | "character"
    | "anecdote"
    | "epilogue"
    | "riddle"
    // Patrimoine-first UX (migration 027 / 2026-05-16) :
    //   - landmark_history (per stop)
    //   - intro_speech / final_riddle / final_explanation (game-wide, stepOrder=0)
    | "landmark_history"
    | "intro_speech"
    | "final_riddle"
    | "final_explanation";
  text: string;
  voiceId: string;
}

/**
 * Détecte si la traduction Gemini a échoué silencieusement.
 *
 * Bug observé sur Lugdunum FR (11/05) : `translateGameField` retourne le
 * texte ANGLAIS inchangé quand Gemini est rate-limited / quota épuisé /
 * a un hiccup réseau qui retourne 200 OK avec contenu identique à l'input.
 * Le résultat n'est pas caché (cf. translate-service.ts), donc invisible
 * en DB — MAIS la pipeline audio en aval prend ce texte EN et génère un
 * MP3 ElevenLabs qui parle anglais avec la voix anglo-native du
 * personnage, alors que l'audio_cache row est taggée `language='fr'`.
 *
 * Résultat client : la cliente lit du texte FR sur l'écran (parfois — autres
 * fields où la traduction a marché) mais entend de l'anglais natif quand
 * elle clique sur le bouton "Écouter". UX cassée, expérience non-livrable.
 *
 * Cette fonction détecte ce cas pour qu'on puisse SKIP la génération audio
 * du field correspondant. Sans audio, le player fall-back sur Web Speech
 * API du navigateur, qui synthétise au moins en FR si la locale navigateur
 * est FR — bien moins glamour qu'ElevenLabs, mais cohérent.
 *
 * Garde-fou longueur : on n'applique le check que sur textes > 30 chars.
 * Sous ce seuil, certains textes courts (noms propres, dates Roman) sont
 * légitimement identiques entre EN et FR (ex: "Pheidon", "MCDXVI") et un
 * faux positif skip-erait l'audio à tort.
 */
function isTranslationFallback(
  translated: string,
  english: string,
  language: string,
): boolean {
  if (language === "en") return false;
  if (!translated || !english) return false;
  if (english.trim().length < 30) return false;
  return translated.trim().toLowerCase() === english.trim().toLowerCase();
}

/**
 * Prepare everything the player needs to play the game in `language`:
 * translated texts (cached) + narration MP3s (cached + uploaded).
 *
 * Static locales (fr/en/de/es/it) skip text translation since the
 * source already includes them — only audio is generated.
 */
export async function prepareGamePackage(
  gameId: string,
  language: string,
): Promise<PackageResult> {
  const t0 = Date.now();
  const errors: string[] = [];
  let audioGenerated = 0;
  let audioSkipped = 0;
  let audioFailed = 0;
  // C1 telemetry accumulators (2026-05-17) : log 1 summary row per
  // provider at the END of the function (vs N rows per call). Granular
  // enough to spot anomalies in the admin dashboard ("game X cost 3×
  // the average") without exploding row count.
  let totalAudioBytes = 0;
  let translationsAttempted = 0;

  const supabase = createAdminClient();

  // 1. Fetch game (title + description + epilogue + check existence).
  // Title and description are shown on the briefing screen, so they
  // must be in the player's language at activation — pre-translating
  // them here means /api/game hits a warm cache instead of a 5-15s
  // Gemini round-trip.
  const { data: game, error: gameErr } = await supabase
    .from("games")
    .select(
      "id, title, description, epilogue_title, epilogue_text, intro_speech, final_riddle_text, final_answer_explanation",
    )
    .eq("id", gameId)
    .single();

  if (gameErr || !game) {
    return {
      success: false,
      gameId,
      language,
      audioGenerated: 0,
      audioSkipped: 0,
      audioFailed: 0,
      durationMs: Date.now() - t0,
      errors: [`Game ${gameId} not found`],
    };
  }

  // Pre-warm the UI translation pack (tutorial + buttons + chrome) so the
  // first page load in this language doesn't trigger /api/translations
  // round-trips. No-op for static locales — those are bundled in code.
  if (!isStaticLocale(language)) {
    try {
      const englishUi: Record<string, string> = {};
      for (const [key, entry] of Object.entries(ui)) {
        englishUi[key] = entry.en || entry.fr || key;
      }
      await translateUIStrings(englishUi, language);
    } catch (err) {
      // Don't fail the whole package on UI pre-warm — the player can
      // still load (the on-demand fetch will catch up).
      console.warn(
        `[game-package] UI pre-warm for ${language} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // 1b. Translate game-level fields (title + description + epilogue_title
  // + epilogue_text) en UN SEUL batch Gemini call.
  //
  // 2026-05-13 — Avant : 4 appels Gemini séparés avec 400ms pacing entre
  // chaque + 4 retries de 220s en cas de rate-limit = jusqu'à 16 min juste
  // pour le game-level. Maintenant : 1 batch via translateStepFields (avec
  // sourceTable="games"), max 1 retry. ~30 sec total.
  if (language !== "en") {
    const gameFields: Record<string, string> = {};
    const englishGameTitle = t(game.title, "en");
    const englishGameDescription = t(game.description, "en");
    const englishGameEpilogueTitle = t(game.epilogue_title, "en");
    const englishGameEpilogueText = t(game.epilogue_text, "en");
    if (englishGameTitle) gameFields.title = englishGameTitle;
    if (englishGameDescription) gameFields.description = englishGameDescription;
    if (englishGameEpilogueTitle) gameFields.epilogue_title = englishGameEpilogueTitle;
    if (englishGameEpilogueText) gameFields.epilogue_text = englishGameEpilogueText;
    if (Object.keys(gameFields).length > 0) {
      try {
        translationsAttempted++;
        await translateStepFields(game.id, gameFields, language, {
          sourceTable: "games",
        });
      } catch (err) {
        console.warn(
          `[game-package] game-level batch translation failed for ${language}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  // 2. Fetch all steps with every translatable field. We pre-translate
  // ALL of them (riddle, anecdote, character dialogue, treasure reward,
  // hints, attractions) so the player API only ever reads from cache —
  // no inline Gemini calls during the playthrough.
  const { data: steps, error: stepsErr } = await supabase
    .from("game_steps")
    .select("id, step_order, title, riddle_text, anecdote, landmark_history, ar_character_dialogue, ar_character_type, ar_treasure_reward, hints, route_attractions")
    .eq("game_id", gameId)
    .order("step_order");

  if (stepsErr || !steps?.length) {
    return {
      success: false,
      gameId,
      language,
      audioGenerated: 0,
      audioSkipped: 0,
      audioFailed: 0,
      durationMs: Date.now() - t0,
      errors: [`No steps found for game ${gameId}`],
    };
  }

  // 3. Check which audio slots are already in cache (idempotency)
  const { data: existing } = await supabase
    .from("audio_cache")
    .select("step_order, slot")
    .eq("game_id", gameId)
    .eq("language", language);

  const cachedSlots = new Set(
    (existing || []).map((r) => `${r.step_order}:${r.slot}`),
  );

  // 4. Build the list of jobs (translate text first, then queue audio)
  const jobs: AudioJob[] = [];

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const step = steps[stepIdx];
    // Pace Gemini calls — bursting too fast triggers a 400 with
    // "API_KEY_INVALID" message that is in fact a soft rate-limit. 800ms
    // between steps keeps the orchestrator under that threshold even on
    // long games. Skipped for the first iteration.
    if (stepIdx > 0 && !isStaticLocale(language)) {
      await new Promise((r) => setTimeout(r, 800));
    }
    // 2026-05-13 — BATCH translation : 1 seul Gemini call par step pour
    // TOUS les fields voiceable + visible (title, riddle, anecdote,
    // character, treasure). Avant : 5 appels séparés × 400ms pacing =
    // 2s minimum par step + 4 retries de 220s chacun en cas de rate-limit
    // = jusqu'à 18 min PAR STEP × 6 steps = 1h48 worst case.
    // Maintenant : 1 batch call × 6 steps = ~30s nominal, ~5 min worst.
    const englishTitle = t(step.title, "en");
    const englishRiddle = t(step.riddle_text, "en");
    const englishCharacter = t(step.ar_character_dialogue, "en");
    const englishAnecdote = t(step.anecdote, "en");
    const englishTreasure = t(step.ar_treasure_reward, "en");
    // Patrimoine-first (vision 2026-05-16) : histoire complète du lieu.
    const englishLandmarkHistory = t(step.landmark_history, "en");

    let riddleText = englishRiddle;
    let characterText = englishCharacter;
    let anecdoteText = englishAnecdote;
    let landmarkHistoryText = englishLandmarkHistory;

    if (language !== "en") {
      const stepFields: Record<string, string> = {};
      if (englishTitle) stepFields.title = englishTitle;
      if (englishRiddle) stepFields.riddle_text = englishRiddle;
      if (englishCharacter) stepFields.ar_character_dialogue = englishCharacter;
      if (englishAnecdote) stepFields.anecdote = englishAnecdote;
      if (englishTreasure) stepFields.ar_treasure_reward = englishTreasure;
      if (englishLandmarkHistory) stepFields.landmark_history = englishLandmarkHistory;
      if (Object.keys(stepFields).length > 0) {
        try {
          const translated = await translateStepFields(
            step.id,
            stepFields,
            language,
          );
          // Assign translated values back (fallback to EN if missing)
          if (translated.riddle_text) riddleText = translated.riddle_text;
          if (translated.ar_character_dialogue)
            characterText = translated.ar_character_dialogue;
          if (translated.anecdote) anecdoteText = translated.anecdote;
          if (translated.landmark_history) landmarkHistoryText = translated.landmark_history;
        } catch (err) {
          console.warn(
            `[game-package] step ${step.step_order} batch translation failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    // Hints + attractions vont via des cache keys séparés (synthétiques).
    if (language !== "en") {
      // hints — JSONB array. Translate each entry's text under the same
      // synthetic cache key the player API uses (`hint-<gameId>-<stepNum>-<idx>`).
      const rawHints = Array.isArray(step.hints) ? step.hints : [];
      for (let hintIdx = 0; hintIdx < rawHints.length; hintIdx++) {
        const hint = rawHints[hintIdx] as { text?: unknown } | null;
        if (!hint || hint.text === undefined || hint.text === null) continue;
        const englishHint = t(hint.text, "en");
        if (!englishHint) continue;
        await new Promise((r) => setTimeout(r, 400));
        try {
          translationsAttempted++;
          await translateGameField(
            `hint-${gameId}-${step.step_order}-${hintIdx}`,
            "game_steps",
            "hint_text",
            englishHint,
            language,
          );
        } catch (err) {
          console.warn(
            `[game-package] step ${step.step_order} hint ${hintIdx} translation failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      // route_attractions — JSONB array of {name, fact}. Translated under
      // the synthetic cache key `<stepId>-attraction-<idx>` via the
      // batch helper (one Gemini call per attraction covering both fields).
      const rawAttractions = Array.isArray(step.route_attractions)
        ? (step.route_attractions as Array<{ name?: unknown; fact?: unknown }>)
        : [];
      for (let attrIdx = 0; attrIdx < rawAttractions.length; attrIdx++) {
        const attr = rawAttractions[attrIdx];
        const enFields: Record<string, string> = {};
        const enName = t(attr?.name, "en");
        const enFact = t(attr?.fact, "en");
        if (enName) enFields.name = enName;
        if (enFact) enFields.fact = enFact;
        if (Object.keys(enFields).length === 0) continue;
        await new Promise((r) => setTimeout(r, 400));
        try {
          translationsAttempted++;
        await translateStepFields(
            `${step.id}-attraction-${attrIdx}`,
            enFields,
            language,
          );
        } catch (err) {
          console.warn(
            `[game-package] step ${step.step_order} attraction ${attrIdx} translation failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    const voiceId = voiceFor(step.ar_character_type, language);

    // ── GARDE-FOU FALLBACK_TO_EN ──────────────────────────────────
    // Détection silent-failure Gemini : si la traduction a échoué et
    // retourné le texte EN inchangé, on NE génère PAS l'audio FR — le
    // MP3 serait du speech anglais avec voix anglophone alors que la
    // row audio_cache prétend être en FR. Player fall-back sur Web
    // Speech API du navigateur (synthèse vocale OS-native en FR).
    const riddleFailed = isTranslationFallback(riddleText, englishRiddle, language);
    const characterFailed = isTranslationFallback(characterText, englishCharacter, language);
    const anecdoteFailed = isTranslationFallback(anecdoteText, englishAnecdote, language);
    if (riddleFailed || characterFailed || anecdoteFailed) {
      const failed = [
        riddleFailed && "riddle",
        characterFailed && "character",
        anecdoteFailed && "anecdote",
      ].filter(Boolean).join(", ");
      console.warn(
        `[game-package] step ${step.step_order} translation FALLBACK_TO_EN detected on [${failed}] → skipping audio for these fields to avoid EN-speech-in-FR-cache.`,
      );
      errors.push(
        `step ${step.step_order} translation_fallback_to_en: [${failed}] — audio not generated, player will use browser TTS`,
      );
    }

    if (riddleText?.trim() && !cachedSlots.has(`${step.step_order}:riddle`) && !riddleFailed) {
      jobs.push({
        stepOrder: step.step_order,
        slot: "riddle",
        text: riddleText,
        voiceId: voiceFor("narrator", language),
      });
    } else if (cachedSlots.has(`${step.step_order}:riddle`)) {
      audioSkipped++;
    }

    if (characterText?.trim() && !cachedSlots.has(`${step.step_order}:character`) && !characterFailed) {
      jobs.push({
        stepOrder: step.step_order,
        slot: "character",
        text: characterText,
        voiceId,
      });
    } else if (cachedSlots.has(`${step.step_order}:character`)) {
      audioSkipped++;
    }

    if (anecdoteText?.trim() && !cachedSlots.has(`${step.step_order}:anecdote`) && !anecdoteFailed) {
      jobs.push({
        stepOrder: step.step_order,
        slot: "anecdote",
        text: anecdoteText,
        voiceId: voiceFor("narrator", language),
      });
    } else if (cachedSlots.has(`${step.step_order}:anecdote`)) {
      audioSkipped++;
    }

    // landmark_history (patrimoine first, vision 2026-05-16) — voice narrator
    const landmarkFailed = isTranslationFallback(
      landmarkHistoryText,
      englishLandmarkHistory,
      language,
    );
    if (
      landmarkHistoryText?.trim() &&
      !cachedSlots.has(`${step.step_order}:landmark_history`) &&
      !landmarkFailed
    ) {
      jobs.push({
        stepOrder: step.step_order,
        slot: "landmark_history",
        text: landmarkHistoryText,
        voiceId: voiceFor("narrator", language),
      });
    } else if (cachedSlots.has(`${step.step_order}:landmark_history`)) {
      audioSkipped++;
    }
  } // end steps loop

  // ─── Game-wide narrative slots (step_order = 0) ───
  // intro_speech / final_riddle / final_explanation = monologues du guide.
  // Voiced with the narrator voice. Translation handled via translateGameField
  // since these are JSONB columns on `games`, not on `game_steps`.
  const gameWideSlots: Array<{
    column: "intro_speech" | "final_riddle_text" | "final_answer_explanation";
    slot: "intro_speech" | "final_riddle" | "final_explanation";
  }> = [
    { column: "intro_speech", slot: "intro_speech" },
    { column: "final_riddle_text", slot: "final_riddle" },
    { column: "final_answer_explanation", slot: "final_explanation" },
  ];

  for (const { column, slot } of gameWideSlots) {
    const englishText = t((game as Record<string, unknown>)[column], "en");
    if (!englishText) continue;

    let translatedText = englishText;
    if (language !== "en") {
      try {
        translationsAttempted++;
        translatedText = await translateGameField(
          game.id,
          "games",
          column,
          englishText,
          language,
        );
      } catch (err) {
        console.warn(
          `[game-package] ${column} translation failed: ${err instanceof Error ? err.message : err} — keeping EN`,
        );
      }
    }

    const failed = isTranslationFallback(translatedText, englishText, language);
    if (failed) {
      console.warn(
        `[game-package] ${column} translation FALLBACK_TO_EN → skipping audio for ${slot}`,
      );
      errors.push(`${column} translation_fallback_to_en — audio not generated`);
      continue;
    }

    if (translatedText?.trim() && !cachedSlots.has(`0:${slot}`)) {
      jobs.push({
        stepOrder: 0,
        slot,
        text: translatedText,
        voiceId: voiceFor("narrator", language),
      });
    } else if (cachedSlots.has(`0:${slot}`)) {
      audioSkipped++;
    }
  }

  // 5. Epilogue (slot=epilogue, conventional step_order=0)
  if (game.epilogue_text) {
    const englishEpilogue = t(game.epilogue_text, "en");
    // Always go through translateGameField — game content was generated
    // in English by Claude, so even "static" locales (fr/de/es/it) need
    // a Gemini call (cached after first hit).
    const epilogueText: string =
      language === "en"
        ? englishEpilogue
        : await translateGameField(
            game.id,
            "games",
            "epilogue_text",
            englishEpilogue,
            language,
          );
    // Garde-fou même logique que les steps : si Gemini a silent-failed
    // et retourné le texte EN inchangé, on NE génère PAS l'audio
    // ElevenLabs FR (ce serait du speech anglais avec voix anglo-native).
    const epilogueFailed = isTranslationFallback(epilogueText, englishEpilogue, language);
    if (epilogueFailed) {
      console.warn(
        `[game-package] epilogue translation FALLBACK_TO_EN detected → skipping audio (would generate EN speech in FR-cache).`,
      );
      errors.push(
        `epilogue translation_fallback_to_en — audio not generated, player will use browser TTS`,
      );
    }
    if (epilogueText?.trim() && !cachedSlots.has(`0:epilogue`) && !epilogueFailed) {
      jobs.push({
        stepOrder: 0,
        slot: "epilogue",
        text: epilogueText,
        voiceId: voiceFor("narrator", language),
      });
    } else if (cachedSlots.has(`0:epilogue`)) {
      audioSkipped++;
    }
  }

  // 6. Generate audio in PARALLEL BATCHES (vision 2026-05-16, post-Aegina
  // timeout). Avant : 32 jobs séquentiels = 3-4 min côté ElevenLabs. Maintenant :
  // batches de 6 en parallèle, ElevenLabs Flash supporte la concurrence sans
  // rate-limit observé jusqu'à 8-10 req simultanées sur le plan Creator.
  // Gain : 32 jobs / 6 ≈ 6 batches × ~5s = ~30s (au lieu de 3-4 min).
  const BATCH_SIZE = 6;
  // Track INCREMENTAL audio bytes generated in THIS call (not the total
  // cache). Fix 2026-05-18 : précédemment on querryait tout l'audio_cache
  // pour le game à la fin, qui donnait le cumul de tous les runs et
  // produisait un over-count 5x dans la telemetry pour les games qui
  // ont eu plusieurs runs de prepareGamePackage (race condition fixée
  // mais le telemetry comptait toujours mal).
  let incrementalAudioBytes = 0;
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (job) => {
        const path = buildAudioPath(gameId, language, job.stepOrder, job.slot);
        const result = await generateAndStoreAudio({
          text: job.text,
          voiceId: job.voiceId,
          storagePath: path,
        });
        const { error: insertErr } = await supabase
          .from("audio_cache")
          .upsert(
            {
              game_id: gameId,
              step_order: job.stepOrder,
              language,
              slot: job.slot,
              storage_path: path,
              public_url: result.publicUrl,
              byte_size: result.byteSize,
            },
            { onConflict: "game_id,step_order,language,slot" },
          );
        if (insertErr) {
          throw new Error(`audio_cache upsert failed: ${insertErr.message}`);
        }
        return {
          stepOrder: job.stepOrder,
          slot: job.slot,
          byteSize: result.byteSize ?? 0,
        };
      }),
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const job = batch[j];
      if (r.status === "fulfilled") {
        audioGenerated++;
        incrementalAudioBytes += r.value.byteSize;
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        errors.push(`step ${job.stepOrder} ${job.slot}: ${msg.slice(0, 150)}`);
        audioFailed++;
      }
    }
  }

  // C1 telemetry — utilise les bytes INCRÉMENTAUX accumulés dans le loop
  // ci-dessus. Évite l'over-count 5x observé sur Concarneau quand plusieurs
  // runs concurrents calculaient chacun le TOTAL cache.
  // Flash pricing : ~$0.0005/s. 1s d'audio ≈ 16 KB MP3 Flash quality.
  totalAudioBytes = incrementalAudioBytes;
  const totalAudioSeconds = totalAudioBytes / 16_384;

  // Log telemetry rows (fire-and-forget, won't throw).
  // CRITICAL : only log if REAL work was done — `audioGenerated > 0` OR
  // `translationsAttempted > 0`. Without this guard, a cron retry that
  // hits the cache (audioGenerated=0, translationsAttempted=0) still
  // inserts 2 rows × N retries = telemetry pollution. Observed 2026-05-18
  // on Lille: 396 rows in 3h for one game because the cron looped.
  if (audioGenerated > 0 || translationsAttempted > 0) {
    await Promise.all([
      audioGenerated > 0
        ? logTelemetry({
            gameId,
            phase: "audio",
            provider: "elevenlabs",
            language,
            audioSeconds: Number(totalAudioSeconds.toFixed(2)),
            apiCalls: audioGenerated,
            durationMs: Date.now() - t0,
            metadata: { audioGenerated, audioSkipped, audioFailed, totalAudioBytes },
          })
        : Promise.resolve(),
      translationsAttempted > 0
        ? logTelemetry({
            gameId,
            phase: "translation",
            provider: "gemini",
            language,
            apiCalls: translationsAttempted,
            metadata: { batches: translationsAttempted },
          })
        : Promise.resolve(),
    ]);
  }

  return {
    success: audioFailed === 0,
    gameId,
    language,
    audioGenerated,
    audioSkipped,
    audioFailed,
    durationMs: Date.now() - t0,
    errors,
  };
}
