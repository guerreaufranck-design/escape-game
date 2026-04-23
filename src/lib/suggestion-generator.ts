/**
 * Suggestion Generator — builds a friendly, contextual recommendation
 * message using Gemini + a restaurant pick.
 *
 * Tone rules (hard-coded in the prompt):
 *  - Friendly local, not salesperson
 *  - Natural mention of weather
 *  - One highlight (specialty OR rating, not both)
 *  - Discount mentioned subtly
 *  - Never use commercial vocabulary
 *
 * This module is DORMANT — nothing imports it yet.
 */

import type { ContextSnapshot } from "./context-engine";
import type { Restaurant } from "./restaurant-search/types";

export interface Suggestion {
  message: string;
  cta: string;
  restaurants: Restaurant[];
  stage: "mid_tour" | "end_of_tour";
  disclaimerLabel: string;
}

const CTA_BY_LANG: Record<string, string> = {
  fr: "Voir le restaurant",
  en: "View restaurant",
  es: "Ver restaurante",
  de: "Restaurant ansehen",
  it: "Vedi ristorante",
  pt: "Ver restaurante",
  nl: "Bekijk restaurant",
  ja: "レストランを見る",
};

const DISCLAIMER_BY_LANG: Record<string, string> = {
  fr: "Partenaire",
  en: "Partner",
  es: "Colaborador",
  de: "Partner",
  it: "Partner",
  pt: "Parceiro",
  nl: "Partner",
  ja: "パートナー",
};

function weatherDescription(
  context: ContextSnapshot,
  lang: string,
): string {
  const t = context.weather.tempC;
  const c = context.weather.condition;
  const coldPhrases: Record<string, string> = {
    fr: "il fait frais",
    en: "it's chilly",
    es: "hace fresco",
    de: "es ist kühl",
    it: "fa freddino",
  };
  const hotPhrases: Record<string, string> = {
    fr: "il fait chaud",
    en: "it's hot",
    es: "hace calor",
    de: "es ist heiß",
    it: "fa caldo",
  };
  const rainPhrases: Record<string, string> = {
    fr: "avec cette pluie",
    en: "with this rain",
    es: "con esta lluvia",
    de: "bei diesem Regen",
    it: "con questa pioggia",
  };
  const snowPhrases: Record<string, string> = {
    fr: "avec cette neige",
    en: "with this snow",
    es: "con esta nieve",
    de: "bei diesem Schnee",
    it: "con questa neve",
  };
  const pick = (m: Record<string, string>) => m[lang] || m.en;

  if (c === "rain") return pick(rainPhrases);
  if (c === "snow") return pick(snowPhrases);
  if (t < 10) return pick(coldPhrases);
  if (t > 28) return pick(hotPhrases);
  return "";
}

function buildMidTourPrompt(
  context: ContextSnapshot,
  restaurant: Restaurant,
): string {
  const weatherHint = weatherDescription(context, context.language);
  return `You are a warm local friend, not a salesperson.

Generate ONE short recommendation (2 sentences max, in ${context.language})
for a player doing a city tour in ${context.city}.

Context:
- Weather: ${context.weather.tempC}°C, ${context.weather.condition}
- Local time: ${context.localTime}
- Weather hint to weave naturally: "${weatherHint || "none"}"

Restaurant to suggest:
- Name: ${restaurant.name}
- Cuisine: ${restaurant.cuisine || "local cuisine"}
- Rating: ${restaurant.rating}/5${restaurant.reviewCount ? ` (${restaurant.reviewCount} reviews)` : ""}
- Distance: ${restaurant.distanceMeters}m away
- Partner discount: ${restaurant.discountPercent}%

Rules:
1. Start naturally — reference weather if relevant (${weatherHint ? "yes" : "optional"})
2. Suggest the place casually, like a friend would
3. Mention ONE strength (cuisine specialty OR rating, pick one — never both)
4. ${restaurant.discountPercent > 0 ? `Mention the ${restaurant.discountPercent}% discount subtly (not salesy)` : "No discount to mention"}
5. NEVER use: "exclusive offer", "limited time", "profitez", "cliquez maintenant", "dear customer", marketing clichés
6. Tone: friendly, warm, local

Output: ONLY the message text, no preamble, no quotes.`;
}

function buildEndOfTourPrompt(
  context: ContextSnapshot,
  restaurants: Restaurant[],
): string {
  const list = restaurants
    .slice(0, 3)
    .map(
      (r, i) =>
        `${i + 1}. ${r.name} — ${r.cuisine || "local"}, ${r.rating}/5, ${r.distanceMeters}m${r.discountPercent > 0 ? `, -${r.discountPercent}%` : ""}`,
    )
    .join("\n");

  return `You are a warm local friend congratulating a player who just finished a city tour in ${context.city}.

Local time: ${context.localTime} (hour: ${context.hourOfDay})
Player just walked a full tour, they are likely tired and hungry.

Three restaurants to suggest:
${list}

Generate a celebratory + warm message (3 sentences max, in ${context.language}):
1. Congrats for finishing the tour (sincere, not cheesy)
2. Acknowledge they might be hungry
3. Introduce the 3 places as "local favorites" / "spots we love", with warmth — NOT as ads

Rules:
- NEVER use: "exclusive deal", "profitez", "best offer", commercial clichés
- Sound like a friend tipping off good spots
- Don't list the restaurants again (the UI will show cards) — just introduce them

Output: ONLY the message text, no preamble, no quotes.`;
}

/**
 * Validate Gemini output — returns null if the message looks off
 * (too long, empty, contains forbidden words).
 */
function validateMessage(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim().replace(/^["']|["']$/g, "");
  if (trimmed.length < 20 || trimmed.length > 600) return null;

  const forbidden = [
    "click here",
    "cliquez ici",
    "limited time",
    "offre exclusive",
    "act now",
    "profitez maintenant",
    "dear customer",
    "cher client",
  ];
  const lower = trimmed.toLowerCase();
  if (forbidden.some((w) => lower.includes(w))) return null;

  return trimmed;
}

/**
 * Generate a contextual suggestion. Returns null when no sensible
 * suggestion can be produced (empty restaurant list, Gemini failure,
 * invalid output). The caller should simply render nothing in that case.
 */
export async function generateSuggestion(
  context: ContextSnapshot,
  restaurants: Restaurant[],
): Promise<Suggestion | null> {
  if (restaurants.length === 0) return null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[suggestion-generator] GEMINI_API_KEY not set");
    return null;
  }

  const prompt =
    context.stage === "end_of_tour"
      ? buildEndOfTourPrompt(context, restaurants)
      : buildMidTourPrompt(context, restaurants[0]);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 300,
          },
        }),
        signal: AbortSignal.timeout(9000),
      },
    );

    if (!res.ok) {
      console.warn(`[suggestion-generator] Gemini returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const message = validateMessage(rawText);
    if (!message) return null;

    return {
      message,
      cta: CTA_BY_LANG[context.language] || CTA_BY_LANG.en,
      disclaimerLabel: DISCLAIMER_BY_LANG[context.language] || DISCLAIMER_BY_LANG.en,
      restaurants:
        context.stage === "end_of_tour"
          ? restaurants.slice(0, 3)
          : [restaurants[0]],
      stage: context.stage,
    };
  } catch (err) {
    console.warn(
      "[suggestion-generator] Gemini call failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
