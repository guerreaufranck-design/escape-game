/**
 * AUDIOGUIDE + JEU (2026-07-18) — modèle par défaut.
 *
 * À chaque stop : le joueur ARRIVE, écoute la DESCRIPTION réelle du lieu
 * (landmark_history, déjà voixée), puis répond à une QUESTION DE DÉDUCTION
 * dont la réponse se DÉDUIT de ce qu'il vient d'entendre (comprendre, pas
 * recopier). Difficulté modérée, 2 indices progressifs (filet), AR en BONUS.
 *
 * Techniquement, on réutilise le "panneau réponse" du mode puzzle (input clair
 * sur l'écran principal + indices + passer + validation offline par hash) :
 *   - puzzleType = "ASSOCIATION"  → le panneau s'affiche
 *   - revealWords = []            → PAS de mots-indices (déduction pure)
 *   - arFacadeText = ""           → l'AR ne révèle jamais la réponse (bonus only)
 * La réponse reste en langue patrimoniale ; question + indices en EN (base,
 * traduits par joueur). Non-bloquant par construction.
 */
import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "./config";
import type { PipelineInput, StructuredGame } from "./types";

const enOf = (v: unknown): string => {
  if (!v) return "";
  if (typeof v === "string") return v;
  const o = v as Record<string, string>;
  return o.en || o.fr || Object.values(o)[0] || "";
};
const norm = (s: string) =>
  s.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]/g, "");

interface QAResult {
  stops: Array<{ step_order: number; riddle: string; answer: string; hint1: string; hint2: string }>;
  final: { answer: string; riddle: string; hint1: string; hint2: string; explanation: string };
}

function buildPrompt(input: PipelineInput, stops: Array<{ step_order: number; landmarkName: string; history: string }>): string {
  const list = stops
    .map((s) => `Stop ${s.step_order} — ${s.landmarkName}\nHISTORY (what the player hears on arrival): ${s.history}`)
    .join("\n\n");
  return `Outdoor AUDIOGUIDE + GAME in ${input.city}. Theme: ${input.theme}${input.themeDescription ? ` — ${input.themeDescription}` : ""}.

At each stop the player HEARS the site's real history (below), then answers a riddle. The answer is DEDUCED from that history — it requires UNDERSTANDING the story, NOT copying a word verbatim. Moderate difficulty: a satisfying little puzzle for someone who listened and thinks. Never trivial, never impossible (hints are the safety net).

The ${stops.length} stops with their history:
${list}

For EACH stop produce:
- "riddle": 1-3 ENGLISH sentences, evocative, tied to the history just heard, ending in a clear question requiring a small deduction. Do NOT state the answer.
- "answer": a SINGLE UPPERCASE word or name (no spaces), genuinely deducible from that stop's history.
- "hint1": ENGLISH gentle nudge (narrows the field).
- "hint2": ENGLISH strong hint that all-but-reveals it (safety net).

Keep the ${stops.length} answers a coherent set. Everything ENGLISH (base, translated later for the player); the answer word stays as chosen.

Also "final": { "answer": single ENGLISH word uniting the answers / the game's core concept, "riddle": 1-2 EN sentences, "hint1", "hint2", "explanation": 1-2 EN sentences }.

Output JSON only:
{ "stops": [ { "step_order":1, "riddle":"...", "answer":"...", "hint1":"...", "hint2":"..." } ], "final": {...} }`;
}

/**
 * Transforme un StructuredGame narré en jeu "audioguide + déduction".
 * Non bloquant : si la génération échoue, on lève (l'appelant décide de
 * publier en l'état legacy plutôt que de perdre le build).
 */
export async function applyAudioguideLayer(input: PipelineInput, game: StructuredGame): Promise<StructuredGame> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing (audioguide)");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const stops = game.stops.map((s) => ({
    step_order: s.step_order,
    landmarkName: s.landmarkName,
    history: enOf(s.landmarkHistory) || s.anecdote || s.riddle,
  }));

  const resp = await client.messages.create({
    model: CONFIG.CLAUDE_MODEL,
    max_tokens: 4000,
    temperature: 0.6,
    messages: [{ role: "user", content: buildPrompt(input, stops) }],
  });
  const text = resp.content[0].type === "text" ? resp.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("audioguide gen: non parseable");
  const data = JSON.parse(m[0]) as QAResult;

  const byOrder = new Map(data.stops.map((p) => [p.step_order, p]));
  game.stops = game.stops.map((s) => {
    const p = byOrder.get(s.step_order);
    if (!p) return s;
    const answer = norm(p.answer);
    return {
      ...s,
      riddle: p.riddle,
      answer,
      arFacadeText: "", // l'AR ne révèle jamais la réponse (bonus visuel only)
      hints: [
        { text: p.hint1, order: 1 },
        { text: p.hint2, order: 2 },
      ],
      // réutilise le panneau réponse sans mots-indices (déduction pure)
      puzzleType: "ASSOCIATION",
      revealWords: [],
      answerSource: "physical", // l'AR ne révèle jamais la réponse
    };
  });

  game.meta.finalAnswer = norm(data.final.answer);
  game.meta.finalRiddleText = data.final.riddle;
  game.meta.finalAnswerExplanation = data.final.explanation;
  game.meta.finalRiddleHints = [data.final.hint1, data.final.hint2, data.final.hint2];

  return game;
}
