/**
 * Regenerate missing hints on a step so it has the canonical 3-hint
 * ladder (#1 atmosphere, #2 OPEN THE AR CAMERA + where, #3 answer
 * shape). Shared by the CLI scripts (fix-tournus-hints,
 * fix-all-games-hints) and the admin "Refresh game" API route.
 *
 * The function is idempotent at the step level: pass a step that
 * already has 3 hints and it returns the existing ones unchanged
 * (no Claude call).
 */

import Anthropic from "@anthropic-ai/sdk";

export interface Hint {
  order: number;
  text: string;
}

export interface StepForHints {
  id: string;
  step_order: number;
  title: unknown;
  riddle_text: unknown;
  answer_text: unknown;
  ar_facade_text: string | null;
  hints: Hint[] | null;
}

function asString(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, string>;
    return o.en || o.fr || Object.values(o)[0] || "";
  }
  return String(v);
}

let claudeClient: Anthropic | null = null;
function getClaude(): Anthropic {
  if (!claudeClient) {
    claudeClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return claudeClient;
}

/**
 * Returns the full 3-hint ladder. If the step already has 3+ hints
 * (truncated to 3 if more), returns them unchanged. Otherwise calls
 * Claude to generate the missing slots.
 */
export async function regenerateStepHints(step: StepForHints): Promise<Hint[]> {
  const existing = Array.isArray(step.hints) ? step.hints : [];
  if (existing.length >= 3) {
    return existing.slice(0, 3).map((h, i) => ({ order: i + 1, text: h.text }));
  }

  const need = 3 - existing.length;
  const existingDescription = existing
    .map((h, i) => `Hint #${i + 1} (already written): ${h.text}`)
    .join("\n");

  const prompt = `You are fixing a step in an outdoor escape game. The step needs a 3-hint ladder. ${existing.length} hint(s) already exist; you must produce the missing ${need} so the full ladder is:
  #1 ATMOSPHERIC nudge — re-anchors the player in the riddle without giving the mechanism away
  #2 OPEN THE AR CAMERA + WHERE TO LOOK — tells the player explicitly to open the AR camera and aim at a specific surface; this is the critical one that unsticks players who don't realise the answer is in AR
  #3 SHAPE OF THE ANSWER — names the format (e.g. "two Latin words", "a 4-digit year") without revealing the literal answer

CONTEXT:
- Step title: ${asString(step.title)}
- Riddle text: ${asString(step.riddle_text)}
- Answer the player must enter: ${asString(step.answer_text)}
- AR overlay text (what materialises on the façade in AR): ${step.ar_facade_text ?? "(none)"}
${existingDescription}

Produce ONLY the missing hints, in JSON, in slot order. Each hint must be under 200 chars.

${need === 2 ? `{"hint2": "...", "hint3": "..."}` : need === 1 ? `{"hint3": "..."}` : `{"hint1": "...", "hint2": "...", "hint3": "..."}`}

No commentary, no markdown fences.`;

  const msg = await getClaude().messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 800,
    temperature: 0.4,
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text : "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`no JSON in response: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]) as { hint1?: string; hint2?: string; hint3?: string };

  const result: Hint[] = [...existing];
  if (need === 3) {
    if (!parsed.hint1?.trim() || !parsed.hint2?.trim() || !parsed.hint3?.trim())
      throw new Error(`missing hints in response: ${JSON.stringify(parsed)}`);
    result.push({ order: 1, text: parsed.hint1.trim() });
    result.push({ order: 2, text: parsed.hint2.trim() });
    result.push({ order: 3, text: parsed.hint3.trim() });
  } else if (need === 2) {
    if (!parsed.hint2?.trim() || !parsed.hint3?.trim())
      throw new Error(`missing hints in response: ${JSON.stringify(parsed)}`);
    result.push({ order: 2, text: parsed.hint2.trim() });
    result.push({ order: 3, text: parsed.hint3.trim() });
  } else if (need === 1) {
    if (!parsed.hint3?.trim())
      throw new Error(`missing hint3 in response: ${JSON.stringify(parsed)}`);
    result.push({ order: 3, text: parsed.hint3.trim() });
  }
  // Re-number to be safe.
  return result.map((h, i) => ({ order: i + 1, text: h.text }));
}
