/**
 * P4 — Garde-fou QA avant publication (2026-07-23).
 *
 * Objectif : qu'un jeu de mauvaise qualité (comme Pézenas 4/10) ne parte JAMAIS
 * au client sans revue. NON bloquant pour la génération : si des problèmes
 * CRITIQUES sont détectés, on lève `needs_review` (le code est retenu côté
 * revendeur jusqu'à validation manuelle) au lieu de publier proprement.
 *
 * Checks :
 *   - déterministe : coordonnées grossièrement hors zone, stops dupliqués ;
 *   - LLM (Claude Haiku) : la RÉPONSE de chaque étape est-elle (1) dans la
 *     bonne langue pour l'audience, (2) un mot unique typable sans ambiguïté
 *     (pas un siècle/date/multi-mots), (3) déductible de l'énigme ?
 *
 * La langue attendue suit la règle revendeur (comme la future génération native
 * P1) : slt-→français, rsc-→espagnol, sinon langue du joueur. OddballTrip EN
 * reste EN → aucun faux positif sur le flux principal.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { PipelineInput, GeocodedLandmark, StructuredGame } from "./types";
import { brandFromSlug } from "@/lib/brand";

export interface QaResult {
  pass: boolean;
  critical: string[];
  warnings: string[];
  expectedLang: string;
}

const LANG_NAME: Record<string, string> = {
  fr: "French",
  en: "English",
  es: "Spanish",
  de: "German",
  it: "Italian",
  nl: "Dutch",
  pt: "Portuguese",
  ja: "Japanese",
};

function langName(code?: string): string {
  return LANG_NAME[(code || "en").toLowerCase()] || code || "English";
}

/** Langue dans laquelle les réponses doivent être écrites pour que le jeu soit
 *  jouable par l'audience du revendeur (aligné sur la génération native P1). */
export function expectedAnswerLanguage(input: PipelineInput): string {
  const brand = brandFromSlug(input.slug);
  if (brand.key === "surlestraces") return "French";
  if (brand.key === "rumbosecreto") return "Spanish";
  return langName(input.language);
}

function distKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(bLat - aLat), dLon = toR(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function llmReview(
  game: StructuredGame,
  expectedLang: string,
): Promise<{ critical: string[]; warnings: string[] }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const stops = game.stops
    .map((s) => `#${s.step_order} "${s.landmarkName}" | riddle: ${s.riddle} | ANSWER: ${s.answer}`)
    .join("\n");

  const prompt = `You are a STRICT quality-assurance reviewer for an audio walking-game. The game must be fully playable by a **${expectedLang}-speaking** player who reads/hears each riddle in ${expectedLang} and must TYPE the answer word exactly.

For each stop and the final answer, flag problems:
1. LANGUAGE — the ANSWER must be a ${expectedLang} word. If an answer is in another language (e.g. an English word while the player language is ${expectedLang}), it is CRITICAL: the ${expectedLang} player will type the ${expectedLang} word and be rejected.
2. TYPEABILITY — the answer must be a SINGLE, stable, unambiguous word the player can type exactly. CRITICAL if it is a century/date ("SEVENTEENTH", "17th", "1687"), a number, a multi-word phrase, or a word with many spelling variants.
3. SOLVABILITY — the answer should be reasonably deducible from its riddle (warning if weak).

Final answer: "${game.meta.finalAnswer}"
Final riddle: ${game.meta.finalRiddleText}

Stops:
${stops}

Return ONLY compact JSON, no prose:
{"critical":["#<n> <short reason>", ...],"warnings":["<short reason>", ...]}
Use empty arrays if all good. Be strict: ANY answer not in ${expectedLang} (LANGUAGE), and ANY non-typeable answer (TYPEABILITY), MUST go in "critical" — never in "warnings". "warnings" is only for weak-solvability nuances.`;

  const resp = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { critical: [], warnings: ["QA LLM: no JSON returned"] };
  const parsed = JSON.parse(m[0]) as { critical?: unknown; warnings?: unknown };
  return {
    critical: Array.isArray(parsed.critical) ? parsed.critical.map(String) : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
  };
}

/** Lance la QA sur le jeu généré. Ne throw jamais — renvoie toujours un QaResult. */
export async function runQaGate(
  input: PipelineInput,
  _selected: GeocodedLandmark[],
  game: StructuredGame,
): Promise<QaResult> {
  const expectedLang = expectedAnswerLanguage(input);
  const critical: string[] = [];
  const warnings: string[] = [];

  // 1) Coordonnées grossièrement hors zone (géocodage aberrant).
  const maxKm = (input.radiusKm || 5) * 2 + 3;
  for (const s of game.stops) {
    const d = distKm(input.startPoint.lat, input.startPoint.lon, s.latitude, s.longitude);
    if (d > maxKm) {
      critical.push(`Stop #${s.step_order} "${s.landmarkName}" est à ${d.toFixed(1)} km du départ (> ${maxKm.toFixed(0)} km) — géocodage suspect`);
    }
  }

  // 2) Stops en doublon de coordonnées (souvent boucle voulue → warning).
  const seen = new Map<string, number>();
  for (const s of game.stops) {
    const k = `${s.latitude.toFixed(5)},${s.longitude.toFixed(5)}`;
    if (seen.has(k)) warnings.push(`Stop #${s.step_order} ("${s.landmarkName}") partage les coordonnées de #${seen.get(k)}`);
    else seen.set(k, s.step_order);
  }

  // 3) Revue LLM (langue des réponses + typabilité) — best-effort.
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await llmReview(game, expectedLang);
      critical.push(...r.critical);
      warnings.push(...r.warnings);
    } catch (e) {
      warnings.push(`QA LLM indisponible: ${e instanceof Error ? e.message : "?"}`);
    }
  }

  return { pass: critical.length === 0, critical, warnings, expectedLang };
}
