/**
 * TRANSLATE — traduit le StructuredGame source (FR par convention) vers
 * autres langues cibles via Gemini Flash.
 *
 * Pourquoi Gemini : pas cher, rapide, bon en multi-lang. Modèle gemini-2.5-flash
 * (à jour en mai 2026).
 *
 * Architecture :
 *   - 1 appel Gemini par langue cible (batch de tous les stops + meta)
 *   - Output JSON parsé pour mise à jour translations_cache
 *
 * Langues supportées : en, de, es, it, pt, nl, ja (ajout simple).
 * Si language source = target → on skip (déjà à jour).
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { StructuredGame, TranslationResult } from "./types";

const MODEL = "gemini-2.5-flash";

const SUPPORTED_LANGUAGES = ["fr", "en", "de", "es", "it", "pt", "nl", "ja"];

function langName(code: string): string {
  const names: Record<string, string> = {
    fr: "français",
    en: "anglais",
    de: "allemand",
    es: "espagnol",
    it: "italien",
    pt: "portugais",
    nl: "néerlandais",
    ja: "japonais",
  };
  return names[code] ?? code;
}

function buildTranslatePrompt(game: StructuredGame, targetLang: string): string {
  return `Traduis le contenu JSON suivant du ${langName(game.sourceLanguage)} vers le ${langName(targetLang)}.

Règles strictes :
1. Renvoie UN OBJET JSON unique avec la même structure que l'input
2. AUCUNE traduction des coordonnées GPS, place_id, step_order (champs techniques)
3. NE TRADUIS PAS les réponses techniques courtes (chiffres comme "1945", "3" — laisse tel quel)
4. Les noms de landmarks (landmarkName) restent dans leur langue d'origine (toponyme reconnu)
5. Le ton narratif (immersif, deuxième personne) doit être préservé
6. ${targetLang === "en" ? "Use natural English, not literal translation" : `Naturel en ${langName(targetLang)}, pas du mot-à-mot`}

JSON source (${langName(game.sourceLanguage)}) :

\`\`\`json
{
  "meta": ${JSON.stringify(game.meta)},
  "stops": ${JSON.stringify(
    game.stops.map((s) => ({
      step_order: s.step_order,
      title: s.title,
      landmarkName: s.landmarkName,
      riddle: s.riddle,
      answer: s.answer,
      hints: s.hints,
      anecdote: s.anecdote,
      arCharacterDialogue: s.arCharacterDialogue,
      arTreasureReward: s.arTreasureReward,
      landmarkHistory: s.landmarkHistory[game.sourceLanguage] ?? "",
    })),
  )}
}
\`\`\`

Renvoie UNIQUEMENT le JSON traduit, sans préambule ni markdown.`;
}

/** Traduit le jeu vers une langue cible. */
export async function translateGame(
  game: StructuredGame,
  targetLang: string,
): Promise<TranslationResult> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
  if (!SUPPORTED_LANGUAGES.includes(targetLang)) {
    throw new Error(`Unsupported language ${targetLang} (supported: ${SUPPORTED_LANGUAGES.join(", ")})`);
  }

  if (targetLang === game.sourceLanguage) {
    // No-op : source = target
    return {
      language: targetLang,
      meta: game.meta,
      stops: game.stops.map((s) => ({
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
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  const prompt = buildTranslatePrompt(game, targetLang);
  const result = await model.generateContent(prompt);
  const text = result.response.text();

  let parsed: { meta: StructuredGame["meta"]; stops: TranslationResult["stops"] };
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Translation JSON parse failed for ${targetLang}: ${e instanceof Error ? e.message : "unknown"}`);
  }

  return { language: targetLang, meta: parsed.meta, stops: parsed.stops };
}

/** Traduit le jeu vers plusieurs langues en parallèle. */
export async function translateGameMulti(
  game: StructuredGame,
  targetLanguages: string[],
): Promise<TranslationResult[]> {
  return Promise.all(targetLanguages.map((lang) => translateGame(game, lang)));
}
