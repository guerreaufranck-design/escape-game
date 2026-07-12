/**
 * PUZZLE LAYER (Phase 1, 2026-07-12) — "déchiffrage sur place".
 *
 * Transforme un StructuredGame (issu de narrate) : à chaque stop, l'RA dévoile
 * 2-3 MOTS et le joueur DÉDUIT la réponse (au lieu de la lire). 3 types :
 *   - ACROSTIC    : 1ʳᵉ lettre de chaque mot révélé = la réponse
 *   - ANAGRAM     : le mot révélé = anagramme de la réponse
 *   - ASSOCIATION : 2-3 mots-indices pointent la réponse (repli sûr)
 *
 * ROBUSTESSE : acrostiche/anagramme sont VÉRIFIÉS mécaniquement. Si Claude
 * échoue après retries, le stop est rétrogradé en ASSOCIATION (toujours
 * livrable) → le build ne bloque JAMAIS. Le FINAL reste en mode "association"
 * (les N réponses → le concept qui les unit), inchangé côté UI.
 *
 * Auto-contenu : rien à vérifier sur le terrain (les mots viennent de nous).
 */
import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "./config";
import type { PipelineInput, StructuredGame } from "./types";

export interface PuzzleStop {
  step_order: number;
  answer: string;
  puzzle_type: "ACROSTIC" | "ANAGRAM" | "ASSOCIATION";
  reveal_words: string[];
  instruction: string;
  hint1: string;
  hint2: string;
}

const norm = (s: string) =>
  s.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z]/g, "");

/** Vrai si le puzzle est mécaniquement valide (acrostiche/anagramme). Association = toujours OK. */
export function verifyPuzzle(p: { puzzle_type: string; reveal_words: string[]; answer: string }): boolean {
  const ans = norm(p.answer);
  if (!ans) return false;
  if (p.puzzle_type === "ACROSTIC") {
    const initials = p.reveal_words.map((w) => norm(w)[0] || "").join("");
    return initials === ans;
  }
  if (p.puzzle_type === "ANAGRAM") {
    const a = norm(p.reveal_words.join("")).split("").sort().join("");
    const b = ans.split("").sort().join("");
    return a.length > 0 && a === b;
  }
  return p.puzzle_type === "ASSOCIATION" && p.reveal_words.length >= 2;
}

function buildPrompt(
  input: PipelineInput,
  stops: Array<{ step_order: number; landmarkName: string; answer: string }>,
  fixNote?: string,
): string {
  const list = stops.map((s) => `${s.step_order}. ${s.landmarkName} (concept actuel: ${s.answer})`).join("\n");
  return `You design the DECIPHER puzzle layer of an outdoor escape game in ${input.city}. Theme: ${input.theme}${input.themeDescription ? ` — ${input.themeDescription}` : ""}.

The ${stops.length} stops (in order), with their current answer concept:
${list}

MECHANIC: at each stop the player's augmented reality reveals 2-3 WORDS; the player must DEDUCE one single answer from them (they type it; correct = next stop unlocks). A real deciphering puzzle — NOT reading the answer off a wall.

⚠️ LANGUAGE SPLIT (critical):
- "answer" and "reveal_words" → keep them in the SAME language as the concepts above (they are the puzzle material, revealed in AR, and stay FIXED for every player). Answers = single UPPERCASE word, NO accents.
- "instruction", "hint1", "hint2" (and the final's) → write them in ENGLISH. They are the base text, translated automatically for each player's language later.

Keep the ${stops.length} answers a COHERENT set (all the same category) so a final word can unite them. You may keep or improve each stop's concept, but every answer must be a single word deducible from its reveal_words.

For EACH stop choose puzzle_type and produce STRICTLY:
- "answer": UPPERCASE, no accents, one word, in the concepts' language.
- "puzzle_type": "ACROSTIC" | "ANAGRAM" | "ASSOCIATION"
- "reveal_words" (in the concepts' language):
   * ACROSTIC  : EXACTLY answer.length words; the FIRST LETTER of each, in order, spells the answer EXACTLY. Real evocative words tied to the landmark/theme.
   * ANAGRAM   : EXACTLY ONE string using EXACTLY the same letters as the answer, reordered into a different pronounceable decoy.
   * ASSOCIATION : 2-3 words/clues that clearly point to the answer by meaning.
- "instruction": 1-2 ENGLISH sentences telling HOW to solve (may reference the revealed words).
- "hint1": gentle ENGLISH nudge (method / a letter).
- "hint2": strong ENGLISH hint (near-reveals it).

Target mix: ~half ACROSTIC, ~2 ANAGRAM, rest ASSOCIATION. Solvable for a tourist who doesn't know ${input.city}.

Also "final": { "answer": word (concepts' language) uniting the ${stops.length} answers (the category), "instruction": ENGLISH, "hint1": ENGLISH, "hint2": ENGLISH, "explanation": 1-2 ENGLISH sentences }.
${fixNote ? `\nIMPORTANT — previous attempt had invalid puzzles. ${fixNote} Fix them so ACROSTIC initials and ANAGRAM letters match EXACTLY.` : ""}

Output JSON ONLY:
{ "stops": [ { "step_order":1, "answer":"...", "puzzle_type":"...", "reveal_words":["..."], "instruction":"...", "hint1":"...", "hint2":"..." } ], "final": { "answer":"...", "instruction":"...", "hint1":"...", "hint2":"...", "explanation":"..." } }`;
}

interface PuzzleResult {
  stops: PuzzleStop[];
  final: { answer: string; instruction: string; hint1: string; hint2: string; explanation: string };
}

async function generate(
  client: Anthropic,
  input: PipelineInput,
  stops: Array<{ step_order: number; landmarkName: string; answer: string }>,
  fixNote?: string,
): Promise<PuzzleResult> {
  const resp = await client.messages.create({
    model: CONFIG.CLAUDE_MODEL,
    max_tokens: 4000,
    temperature: 0.6,
    messages: [{ role: "user", content: buildPrompt(input, stops, fixNote) }],
  });
  const text = resp.content[0].type === "text" ? resp.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("puzzle gen: non parseable");
  return JSON.parse(m[0]) as PuzzleResult;
}

/**
 * Applique la couche puzzle au game narré. Jusqu'à 3 tentatives pour maximiser
 * les acrostiches/anagrammes valides ; les stops encore invalides sont
 * rétrogradés en ASSOCIATION (repli sûr) — le build ne bloque jamais.
 */
export async function applyPuzzleLayer(input: PipelineInput, game: StructuredGame): Promise<StructuredGame> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing (puzzles)");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const baseStops = game.stops.map((s) => ({ step_order: s.step_order, landmarkName: s.landmarkName, answer: s.answer }));

  let best: PuzzleResult | null = null;
  let bestBad = Infinity;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res: PuzzleResult;
    try {
      const badNote = best ? `Invalid step_orders: ${best.stops.filter((p) => !verifyPuzzle(p)).map((p) => p.step_order).join(", ")}.` : undefined;
      res = await generate(client, input, baseStops, attempt > 1 ? badNote : undefined);
    } catch {
      continue;
    }
    const bad = res.stops.filter((p) => !verifyPuzzle(p)).length;
    if (bad < bestBad) { best = res; bestBad = bad; }
    if (bad === 0) break;
  }
  if (!best) throw new Error("puzzle gen failed after retries");

  // Rétrograde les puzzles encore invalides en ASSOCIATION (repli sûr).
  const byOrder = new Map<number, PuzzleStop>();
  for (const p of best.stops) {
    if (!verifyPuzzle(p)) {
      p.puzzle_type = "ASSOCIATION";
      if (!Array.isArray(p.reveal_words) || p.reveal_words.length < 2) {
        // garantit 2 mots-indices minimaux
        p.reveal_words = [p.reveal_words?.[0] || game.stops.find((s) => s.step_order === p.step_order)?.landmarkName || "indice", input.theme];
      }
    }
    byOrder.set(p.step_order, p);
  }

  // Fusionne dans le game.
  game.stops = game.stops.map((s) => {
    const p = byOrder.get(s.step_order);
    if (!p) return s;
    const answer = norm(p.answer);
    return {
      ...s,
      answer,
      arFacadeText: answer, // révélé seulement en dernier recours (skip)
      riddle: p.instruction,
      hints: [
        { text: p.hint1, order: 1 },
        { text: p.hint2, order: 2 },
      ],
      puzzleType: p.puzzle_type,
      revealWords: p.reveal_words,
    };
  });

  // Final : mode association (inchangé côté UI).
  game.meta.finalAnswer = norm(best.final.answer);
  game.meta.finalRiddleText = best.final.instruction;
  game.meta.finalAnswerExplanation = best.final.explanation;
  game.meta.finalRiddleHints = [best.final.hint1, best.final.hint2, best.final.hint2];

  return game;
}
