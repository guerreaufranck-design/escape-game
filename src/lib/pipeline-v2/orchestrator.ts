/**
 * ORCHESTRATOR v4 — pipeline finale validée user 2026-05-25.
 *
 * Séquence :
 *   0. Validate startPoint (reject si manquant)
 *   1. DISCOVER (Perplexity sonar-deep-research) : MAX landmarks pertinents
 *      dans rayon adaptatif (walking 1.75km / roadtrip input.radiusKm)
 *   2. GEOCODE (Google Places) : géolocalise TOUS, AUCUN filtre
 *   3. SELECT (Perplexity passe 2) : choisit 8 meilleurs (5 mini) parmi
 *      les géocodés en fonction du scénario
 *   4. Si < 5 sélectionnés → halt + needs_review + alerte mail
 *   5. NARRATE (Claude Sonnet 4.5) : écrit la narration en EN
 *   6. Persist game master EN
 *   7. TRANSLATE (Gemini) : EN → langue client (skip si client=EN)
 *   8. AUDIO (ElevenLabs) : UNIQUEMENT langue client
 *   9. Done
 */

import type {
  AudioResult,
  PipelineInput,
  PipelineV2Output,
  TranslationResult,
} from "./types";
import { runDiscovery } from "./discover";
import { runGeocode } from "./geocode";
import { runSelect } from "./select";
import { runNarrate } from "./narrate";
import { persistGame, persistTranslations, persistAudios } from "./persist";
import { translateGame } from "./translate";
import { generateAudioForLanguage } from "./audio";

const MIN_SELECTED_LANDMARKS = 5;

export interface OrchestratorOptions {
  skipAudio?: boolean;
  audioSpeed?: number;
}

export async function runPipelineV2(
  input: PipelineInput,
  gameId: string,
  options: OrchestratorOptions = {},
): Promise<PipelineV2Output> {
  const t0 = Date.now();
  console.log(`[v4] START slug=${input.slug} city=${input.city} clientLang=${input.language} mode=${input.transportMode ?? "walking"}`);

  // ── 0. Validate startPoint ────────────────────────────
  if (!input.startPoint) {
    throw new Error(
      `startPoint missing for slug=${input.slug} — pipeline requires explicit GPS start point`,
    );
  }
  console.log(`[v4] startPoint OK : ${input.startPoint.lat}, ${input.startPoint.lon}`);

  // ── 1. Discovery (Perplexity passe 1 — MAX coverage) ──
  const discovery = await runDiscovery(input);
  console.log(`[v4] discovery done — ${discovery.landmarks.length} candidats bruts, warning=${discovery.warning ? "YES" : "no"}`);

  // ── 2. Geocode (Google pur, aucun filtre) ─────────────
  const geocode = await runGeocode(input, discovery.landmarks);
  console.log(`[v4] geocode done — ${geocode.geocoded.length} géocodés, ${geocode.failed.length} non trouvés Google`);

  if (geocode.geocoded.length === 0) {
    const reason = `Aucun landmark géocodé par Google sur ${discovery.landmarks.length} candidats Perplexity`;
    await persistEmptyGame(gameId, input, reason, geocode.startPoint);
    return haltOutput(input, discovery, geocode, reason);
  }

  // ── 3. Select (Perplexity passe 2) ────────────────────
  const selection = await runSelect(input, geocode);
  console.log(`[v4] select done — ${selection.selected.length} landmarks sélectionnés`);

  // ── 4. Garde-fou : minimum 5 ──────────────────────────
  if (selection.selected.length < MIN_SELECTED_LANDMARKS) {
    const reason = `Seulement ${selection.selected.length} landmarks sélectionnés par Perplexity (min ${MIN_SELECTED_LANDMARKS}). Alerte email à envoyer à l'opérateur.`;
    console.error(`[v4] HALT — ${reason}`);
    await persistEmptyGame(gameId, input, reason, geocode.startPoint);
    // TODO: envoyer email alerte ici (logique séparée, non implémentée dans ce commit)
    return haltOutput(input, discovery, geocode, reason);
  }

  // ── 5. Narrate (Claude écrit la narration EN) ─────────
  const structured = await runNarrate(input, selection.selected, discovery.warning);
  console.log(`[v4] narrate done — ${structured.stops.length} stops habillés EN`);

  // ── 6. Persist game master EN ─────────────────────────
  await persistGame(gameId, input, structured, false, undefined, geocode.startPoint);

  // Source as translation (EN)
  const sourceAsTranslation: TranslationResult = {
    language: "en",
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
  try {
    await persistTranslations(gameId, [sourceAsTranslation]);
  } catch (e) {
    console.warn(`[v4] persistTranslations EN non-blocking error: ${e instanceof Error ? e.message : "?"}`);
  }

  // ── 7. Translate (EN → client) ────────────────────────
  const clientLang = input.language.toLowerCase().slice(0, 2);
  let clientTranslation: TranslationResult = sourceAsTranslation;
  if (clientLang !== "en") {
    console.log(`[v4] translate EN → ${clientLang}...`);
    try {
      clientTranslation = await translateGame(structured, clientLang);
      await persistTranslations(gameId, [clientTranslation]);
      console.log(`[v4] translate done`);
    } catch (e) {
      console.warn(`[v4] translate ${clientLang} non-blocking error: ${e instanceof Error ? e.message : "?"}`);
      clientTranslation = sourceAsTranslation;
    }
  }

  // ── 8. Audio UNIQUEMENT langue client ─────────────────
  let audios: AudioResult[] = [];
  if (!options.skipAudio) {
    console.log(`[v4] audio in "${clientLang}" only...`);
    try {
      const audio = await generateAudioForLanguage(gameId, structured, clientTranslation, {
        speed: options.audioSpeed,
      });
      audios = [audio];
      await persistAudios(gameId, audios);
      console.log(`[v4] audio done — ${audio.files.length} files`);
    } catch (e) {
      console.warn(`[v4] audio non-blocking error: ${e instanceof Error ? e.message : "?"}`);
    }
  }

  const totalSec = Math.round((Date.now() - t0) / 1000);
  console.log(`[v4] DONE in ${totalSec}s — slug=${input.slug} stops=${structured.stops.length} audios=${audios.flatMap((a) => a.files).length}`);

  return {
    input,
    discovery,
    geocode,
    structure: structured,
    translations: clientLang !== "en" ? [clientTranslation] : [],
    audios,
    qualityFlags: [],
    needsReview: false,
  };
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

async function persistEmptyGame(
  gameId: string,
  input: PipelineInput,
  reason: string,
  startPoint: { lat: number; lon: number },
) {
  await persistGame(
    gameId,
    input,
    {
      meta: {
        title: input.theme,
        description: input.themeDescription ?? "",
        intro: "",
        epilogue: "",
        epilogueTitle: "",
        finalRiddleText: "",
        finalAnswer: "",
        finalAnswerExplanation: "",
      },
      stops: [],
      sourceLanguage: "en",
    },
    true,
    reason,
    startPoint,
  );
}

function haltOutput(
  input: PipelineInput,
  discovery: PipelineV2Output["discovery"],
  geocode: PipelineV2Output["geocode"],
  reason: string,
): PipelineV2Output {
  return {
    input,
    discovery,
    geocode,
    structure: {
      meta: {
        title: input.theme,
        description: "",
        intro: "",
        epilogue: "",
        epilogueTitle: "",
        finalRiddleText: "",
        finalAnswer: "",
        finalAnswerExplanation: "",
      },
      stops: [],
      sourceLanguage: "en",
    },
    translations: [],
    audios: [],
    qualityFlags: [{ phase: "geocode", severity: "critical", message: reason }],
    needsReview: true,
    reviewReason: reason,
  };
}
