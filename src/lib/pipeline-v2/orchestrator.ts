/**
 * ORCHESTRATOR — flow principal du pipeline v2.
 *
 * Étapes :
 *   1. Discovery (Perplexity FR riche)
 *   2. Geocode (Google Places anti-bias)
 *   3. Structure (Claude markdown → JSON game_steps)
 *   4. Quality Gate (halt + needs_review si suspect)
 *   5. Persist game + game_steps (DB)
 *   6. Translate (parallèle multi-lang)
 *   7. Persist translations
 *   8. Audio (séquentiel par lang)
 *   9. Persist audios
 *
 * Tous les artefacts intermédiaires sont retournés pour audit.
 *
 * Le flow est conçu pour s'arrêter au plus tard à l'étape 4 si Quality
 * Gate dit critical → on persiste quand même le draft mais avec
 * needs_review=true (pas de translations + audios → on attend OK humain).
 */

import type {
  AudioResult,
  PipelineInput,
  PipelineV2Output,
  TranslationResult,
} from "./types";
import { runDiscovery } from "./discover";
import { runGeocode } from "./geocode";
import { runStructure } from "./structure";
import { runQualityGate } from "./quality-gate";
import {
  persistGame,
  persistTranslations,
  persistAudios,
} from "./persist";
import { translateGameMulti } from "./translate";
import { generateAudioMulti } from "./audio";

export interface OrchestratorOptions {
  /** Langues cibles à générer EN PLUS de la source. Ex: ["en", "de"]. */
  translateTo?: string[];
  /** Skip audio generation (pour debug rapide ou rebuild texte-only). */
  skipAudio?: boolean;
  /** Audio speed (1.0 default, 1.1 sur MSM). */
  audioSpeed?: number;
}

export async function runPipelineV2(
  input: PipelineInput,
  gameId: string,
  options: OrchestratorOptions = {},
): Promise<PipelineV2Output> {
  const t0 = Date.now();
  console.log(`[v2] START slug=${input.slug} city=${input.city} lang=${input.language}`);

  // 1. Discovery
  console.log(`[v2] phase=discovery starting...`);
  const discovery = await runDiscovery(input);
  console.log(`[v2] phase=discovery done — ${discovery.landmarks.length} landmarks, warning=${discovery.warning ? "YES" : "no"}`);

  // 2. Geocode
  console.log(`[v2] phase=geocode starting...`);
  const geocode = await runGeocode(input, discovery.landmarks);
  console.log(`[v2] phase=geocode done — ${geocode.geocoded.length} ok / ${geocode.failed.length} failed`);

  // 3. Structure
  console.log(`[v2] phase=structure starting...`);
  const structured = await runStructure(input, discovery, geocode);
  console.log(`[v2] phase=structure done — ${structured.stops.length} stops`);

  // 4. Quality Gate
  const quality = runQualityGate(input, discovery, geocode, structured);
  console.log(`[v2] phase=quality_gate — needsReview=${quality.needsReview}, flags=${quality.flags.length}`);

  // 5. Persist game (toujours, même si needsReview — admin a accès à la draft)
  await persistGame(
    gameId,
    input,
    structured,
    quality.needsReview,
    quality.reason,
    geocode.startPoint,
  );

  // Si needs review → on s'arrête avant trad + audio (pas la peine de gaspiller crédits)
  if (quality.needsReview) {
    console.log(`[v2] HALT for review : ${quality.reason}`);
    return {
      input,
      discovery,
      geocode,
      structure: structured,
      translations: [],
      audios: [],
      qualityFlags: quality.flags,
      needsReview: true,
      reviewReason: quality.reason,
    };
  }

  // 6. Translate (autres langues)
  const translateTo = options.translateTo ?? [];
  const targetLangs = translateTo.filter((l) => l !== input.language);
  let translations: TranslationResult[] = [];
  if (targetLangs.length > 0) {
    console.log(`[v2] phase=translate starting for ${targetLangs.join(",")}...`);
    translations = await translateGameMulti(structured, targetLangs);
    console.log(`[v2] phase=translate done — ${translations.length} languages`);
    await persistTranslations(gameId, translations);
  }

  // Add la "translation" source (FR) pour cohérence : ça donne le contenu source aussi
  // dans translations_cache pour réutilisation facile.
  const sourceAsTranslation: TranslationResult = {
    language: input.language,
    meta: structured.meta,
    stops: structured.stops.map((s) => ({
      step_order: s.step_order,
      title: s.title,
      landmarkName: s.landmarkName,
      riddle: s.riddle,
      anecdote: s.anecdote,
      arCharacterDialogue: s.arCharacterDialogue,
      arTreasureReward: s.arTreasureReward,
      hint: s.hints[0]?.text ?? "",
    })),
  };
  await persistTranslations(gameId, [sourceAsTranslation]);

  // 7. Audio (séquentiel par lang pour pas saturer ElevenLabs)
  let audios: AudioResult[] = [];
  if (!options.skipAudio) {
    const allTranslations = [sourceAsTranslation, ...translations];
    console.log(`[v2] phase=audio starting for ${allTranslations.length} languages...`);
    audios = await generateAudioMulti(gameId, structured, allTranslations, {
      speed: options.audioSpeed,
    });
    console.log(`[v2] phase=audio done — ${audios.length} languages × ${audios[0]?.files?.length ?? 0} files`);
    await persistAudios(gameId, audios);
  }

  const totalMs = Date.now() - t0;
  console.log(`[v2] DONE in ${Math.round(totalMs / 1000)}s — slug=${input.slug}`);

  return {
    input,
    discovery,
    geocode,
    structure: structured,
    translations,
    audios,
    qualityFlags: quality.flags,
    needsReview: false,
  };
}
