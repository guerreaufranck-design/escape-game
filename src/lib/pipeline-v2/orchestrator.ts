/**
 * ORCHESTRATOR v3 — pipeline propre EN-natif.
 *
 * Étapes :
 *   0. Validate startPoint (reject if missing — diamètre 3.5 km imposé)
 *   1. Discover EN (Perplexity sonar-deep-research, tous landmarks pertinents)
 *   2. Geocode + 3 filtres durs (similarity / radius 1.75km / dedup 50m)
 *   3. Select EN (Claude trie pool, écrit jeu en EN — "master version")
 *   4. Quality Gate
 *   5. Persist game + steps (master EN)
 *   6. Translate EN → langue client (si != EN)
 *   7. Audio dans langue client UNIQUEMENT
 *   8. Done
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
import { runQualityGate } from "./quality-gate";
import { persistGame, persistTranslations, persistAudios } from "./persist";
import { translateGame } from "./translate";
import { generateAudioForLanguage } from "./audio";

export interface OrchestratorOptions {
  /** Skip audio generation (dev/debug). */
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
  console.log(`[v3] START slug=${input.slug} city=${input.city} clientLang=${input.language}`);

  // ── 0. Validate startPoint ────────────────────────────────
  if (!input.startPoint) {
    throw new Error(
      `startPoint missing for slug=${input.slug} — v3 pipeline requires explicit GPS start point (mandate user 2026-05-25)`,
    );
  }
  console.log(`[v3] startPoint OK : ${input.startPoint.lat}, ${input.startPoint.lon}`);

  // ── 1. Discovery EN ──────────────────────────────────────
  const discovery = await runDiscovery(input);
  console.log(
    `[v3] discovery done — ${discovery.landmarks.length} candidates, warning=${discovery.warning ? "YES" : "no"}`,
  );

  // ── 2. Geocode + 3 hard filters ──────────────────────────
  const geocode = await runGeocode(input, discovery.landmarks);
  console.log(`[v3] geocode done — ${geocode.geocoded.length} validated / ${geocode.failed.length} rejected`);

  if (geocode.geocoded.length < 7) {
    // Insuffisant — needs_review humain, pas de publication
    const reason = `Only ${geocode.geocoded.length} landmarks survived filters (need ≥7). Rejected: ${geocode.failed.map((f) => `${f.landmark.name} (${f.reason})`).slice(0, 5).join("; ")}`;
    console.warn(`[v3] HALT for review : ${reason}`);
    // Persist a minimal game row with needs_review so admin sees it
    await persistGame(
      gameId,
      input,
      // Minimal stub — Claude wasn't called
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
      geocode.startPoint,
    );
    return {
      input,
      discovery,
      geocode,
      structure: { meta: { title: input.theme, description: "", intro: "", epilogue: "", epilogueTitle: "", finalRiddleText: "", finalAnswer: "", finalAnswerExplanation: "" }, stops: [], sourceLanguage: "en" },
      translations: [],
      audios: [],
      qualityFlags: [{ phase: "geocode", severity: "critical", message: reason }],
      needsReview: true,
      reviewReason: reason,
    };
  }

  // ── 3. Select EN (Claude trie + écrit) ───────────────────
  const structured = await runSelect(input, discovery, geocode);
  console.log(`[v3] select done — ${structured.stops.length} stops, master in EN`);

  // ── 4. Quality Gate ──────────────────────────────────────
  const quality = runQualityGate(input, discovery, geocode, structured);
  console.log(`[v3] quality_gate — needsReview=${quality.needsReview}, flags=${quality.flags.length}`);

  // ── 5. Persist game master EN ────────────────────────────
  await persistGame(
    gameId,
    input,
    structured,
    quality.needsReview,
    quality.reason,
    geocode.startPoint,
  );

  if (quality.needsReview) {
    console.warn(`[v3] HALT for review : ${quality.reason}`);
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

  // Build source-as-translation (EN) for persistence + downstream audio
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
  // Persist EN translation
  try {
    await persistTranslations(gameId, [sourceAsTranslation]);
  } catch (e) {
    console.warn(`[v3] persistTranslations EN failed (non-blocking): ${e instanceof Error ? e.message : "?"}`);
  }

  // ── 6. Translate EN → client language (if different) ─────
  const clientLang = input.language.toLowerCase().slice(0, 2);
  let clientTranslation: TranslationResult = sourceAsTranslation;
  if (clientLang !== "en") {
    console.log(`[v3] translate EN → ${clientLang}...`);
    try {
      clientTranslation = await translateGame(structured, clientLang);
      await persistTranslations(gameId, [clientTranslation]);
      console.log(`[v3] translate done`);
    } catch (e) {
      console.warn(`[v3] translate ${clientLang} failed (non-blocking): ${e instanceof Error ? e.message : "?"}`);
      // Garde-fou : si trad plante, on continue avec EN comme fallback texte
      clientTranslation = sourceAsTranslation;
    }
  }

  // ── 7. Audio dans langue client UNIQUEMENT ───────────────
  let audios: AudioResult[] = [];
  if (!options.skipAudio) {
    console.log(`[v3] audio generation in "${clientLang}" only (mandate user — no speculative audio)...`);
    try {
      const audio = await generateAudioForLanguage(gameId, structured, clientTranslation, {
        speed: options.audioSpeed,
      });
      audios = [audio];
      await persistAudios(gameId, audios);
      console.log(`[v3] audio done — ${audio.files.length} files in ${clientLang}`);
    } catch (e) {
      console.warn(`[v3] audio failed (non-blocking — text fallback): ${e instanceof Error ? e.message : "?"}`);
    }
  }

  const totalSec = Math.round((Date.now() - t0) / 1000);
  console.log(`[v3] DONE in ${totalSec}s — slug=${input.slug} stops=${structured.stops.length} audios=${audios.flatMap((a) => a.files).length}`);

  return {
    input,
    discovery,
    geocode,
    structure: structured,
    translations: clientLang !== "en" ? [clientTranslation] : [],
    audios,
    qualityFlags: quality.flags,
    needsReview: false,
  };
}
