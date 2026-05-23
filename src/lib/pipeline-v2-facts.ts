/**
 * Pipeline V2 — Facts extractor (2026-05-23).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Replaces Perplexity Deep Research (sonar-deep-research model).
 * ═══════════════════════════════════════════════════════════════════
 *
 * Why this exists :
 *
 *   Perplexity DR was meant to provide factual anchors (real figures,
 *   precise dates, traditions) for the narration phase. In practice
 *   it had three structural problems :
 *
 *     1. SLOW : 2-5 min per call, regularly pushing the Vercel
 *        step.run() budget toward timeout.
 *     2. EXPENSIVE : ~$0.40 per call (10× more than Claude Haiku).
 *     3. UNRELIABLE : observed empty returns (quality 0.01) on
 *        2026-05-23 V6 — the API itself regressed without warning.
 *
 *   Claude Haiku (haiku-4-5) has solid factual grounding for any
 *   reasonably-documented historic event and returns in <5s for
 *   <$0.005. The trust gap is acceptable :
 *     - The output is used as NARRATION ANCHORS, not legal claims.
 *     - The thematic judge (downstream) catches gross errors.
 *     - Wikipedia-grade accuracy is sufficient for an escape-game.
 *
 *   Output format matches the existing `VerifiedThemeContext`
 *   interface so downstream consumers (narration, judges) don't
 *   need any changes.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { VerifiedThemeContext } from "./perplexity";

const EMPTY_CONTEXT: VerifiedThemeContext = {
  iconicSites: [],
  realFigures: [],
  events: [],
  localTraditions: [],
  rawSummary: "",
};

const SYSTEM_PROMPT = `You are a historian who knows the documented facts about cities, events, and people throughout European and world history.

Your job : given a theme + city, extract STRUCTURED factual anchors that an escape-game narrator can cite credibly.

═══════════════════════════════════════════════════════════
OUTPUT CONTRACT (strict JSON, no markdown)
═══════════════════════════════════════════════════════════

{
  "iconicSites": [
    {
      "name": "<full named landmark, geocodable on Google Maps>",
      "locationHint": "<short verbal geo hint, e.g. 'old town center'>",
      "significance": "<one sentence : why this site matters for this theme>",
      "sources": ["<short ref, e.g. 'Britannica' or 'Wikipedia EN'>"]
    },
    ... up to 6 entries
  ],
  "realFigures": [
    {
      "name": "<full name as historians cite it>",
      "role": "<short role : 'Last abbot of Cluny', 'Cathar parfait of Béziers'>",
      "lifespan": "<years OR century, e.g. '1731-1812' or '12th century'>",
      "sources": ["<short ref>"]
    },
    ... up to 5 entries
  ],
  "events": [
    {
      "date": "<most precise : YYYY-MM-DD or YYYY or 'Xth century'>",
      "description": "<one sentence>",
      "sources": ["<short ref>"]
    },
    ... up to 6 entries
  ],
  "localTraditions": [
    {
      "description": "<one sentence local custom / legend>",
      "sources": ["<short ref>"]
    },
    ... up to 4 entries
  ],
  "rawSummary": "<2-3 sentences summary tying theme + city + period>"
}

═══════════════════════════════════════════════════════════
HARD RULES
═══════════════════════════════════════════════════════════

  - ONLY cite figures, dates, events you are CONFIDENT about. If
    uncertain, OMIT — don't fabricate.
  - For "events" : prefer events with KNOWN YEARS (used as magic
    words downstream).
  - For "iconicSites" : prefer NAMED, STILL-STANDING landmarks
    geocodable on Google Maps. "The old market square" is too vague —
    "Place du Vieux Marché, [city]" is good.
  - For "realFigures" : prefer figures with documented lifespan.
    Generic "the local abbot" doesn't count.
  - Skip "sources" array contents that you can't verify — use ["Wikipedia"]
    only if you're sure the figure/event has a Wikipedia article.
  - If the theme is a clear FICTION (e.g. "a treasure hunt in Paris"),
    return mostly-empty arrays and a short rawSummary acknowledging
    the fictional frame.
  - If you genuinely don't know this city's history for this theme,
    return EMPTY arrays rather than guess.

OUTPUT JSON ONLY. No preamble, no explanation, no markdown fences.`;

function buildUserPrompt(input: {
  theme: string;
  themeDescription: string;
  productDescription?: string;
  city: string;
  country: string;
  narrative?: string;
}): string {
  const productBlock =
    input.productDescription && input.productDescription.length > 50
      ? `\nPRODUCT-PAGE DESCRIPTION (rich context, the customer's pitch) :\n"""${input.productDescription.trim().slice(0, 2000)}"""\n`
      : "";
  const narrativeBlock = input.narrative
    ? `\nNARRATIVE PITCH : ${input.narrative.slice(0, 500)}\n`
    : "";
  return `THEME : ${input.theme}
THEME DESCRIPTION : ${input.themeDescription}
CITY : ${input.city}, ${input.country}
${productBlock}${narrativeBlock}
Extract structured factual anchors. Return JSON only.`;
}

export interface ExtractFactsInput {
  theme: string;
  themeDescription: string;
  productDescription?: string;
  city: string;
  country: string;
  narrative?: string;
}

/**
 * Extract a VerifiedThemeContext from theme + city via Claude Haiku.
 *
 * Returns EMPTY_CONTEXT on any error (fail-open). The downstream
 * pipeline already handles empty context as a degraded-but-survivable
 * case (the quality scorer flags it but doesn't block publish).
 */
export async function extractThemeFacts(
  input: ExtractFactsInput,
): Promise<VerifiedThemeContext> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[v2-facts] ANTHROPIC_API_KEY missing — returning empty context");
    return EMPTY_CONTEXT;
  }

  const client = new Anthropic({ apiKey });
  let text = "";
  try {
    const msg = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 2400,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(input) }],
      },
      { timeout: 30_000 },
    );
    text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    console.warn(
      `[v2-facts] Claude call failed: ${err instanceof Error ? err.message : err} — returning empty context (downstream handles)`,
    );
    return EMPTY_CONTEXT;
  }

  const jsonText = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch (err) {
    console.warn(
      `[v2-facts] Claude returned non-JSON (${err instanceof Error ? err.message : err}) — returning empty context. Body: ${text.slice(0, 200)}`,
    );
    return EMPTY_CONTEXT;
  }

  // Safe normalization (mirror the Perplexity parsing in perplexity.ts)
  const ctx: VerifiedThemeContext = {
    iconicSites: Array.isArray(parsed.iconicSites)
      ? (parsed.iconicSites as unknown[]).slice(0, 8).map((s) => {
          const r = (s ?? {}) as Record<string, unknown>;
          return {
            name: typeof r.name === "string" ? r.name : "",
            locationHint:
              typeof r.locationHint === "string" ? r.locationHint : undefined,
            significance:
              typeof r.significance === "string" ? r.significance : "",
            sources: Array.isArray(r.sources)
              ? (r.sources as unknown[])
                  .filter((x): x is string => typeof x === "string")
                  .slice(0, 5)
              : [],
          };
        }).filter((x) => x.name.length > 2)
      : [],
    realFigures: Array.isArray(parsed.realFigures)
      ? (parsed.realFigures as unknown[]).slice(0, 6).map((f) => {
          const r = (f ?? {}) as Record<string, unknown>;
          return {
            name: typeof r.name === "string" ? r.name : "",
            role: typeof r.role === "string" ? r.role : "",
            lifespan: typeof r.lifespan === "string" ? r.lifespan : undefined,
            sources: Array.isArray(r.sources)
              ? (r.sources as unknown[])
                  .filter((x): x is string => typeof x === "string")
                  .slice(0, 5)
              : [],
          };
        }).filter((x) => x.name.length > 2)
      : [],
    events: Array.isArray(parsed.events)
      ? (parsed.events as unknown[]).slice(0, 8).map((e) => {
          const r = (e ?? {}) as Record<string, unknown>;
          return {
            date: typeof r.date === "string" ? r.date : "",
            description:
              typeof r.description === "string" ? r.description : "",
            sources: Array.isArray(r.sources)
              ? (r.sources as unknown[])
                  .filter((x): x is string => typeof x === "string")
                  .slice(0, 5)
              : [],
          };
        }).filter((x) => x.description.length > 5)
      : [],
    localTraditions: Array.isArray(parsed.localTraditions)
      ? (parsed.localTraditions as unknown[]).slice(0, 6).map((t) => {
          const r = (t ?? {}) as Record<string, unknown>;
          return {
            description:
              typeof r.description === "string" ? r.description : "",
            sources: Array.isArray(r.sources)
              ? (r.sources as unknown[])
                  .filter((x): x is string => typeof x === "string")
                  .slice(0, 5)
              : [],
          };
        }).filter((x) => x.description.length > 5)
      : [],
    rawSummary:
      typeof parsed.rawSummary === "string"
        ? parsed.rawSummary.slice(0, 1500)
        : "",
  };
  console.log(
    `[v2-facts] extracted ${ctx.iconicSites.length} sites, ${ctx.realFigures.length} figures, ${ctx.events.length} events, ${ctx.localTraditions.length} traditions for "${input.theme}" in ${input.city}`,
  );
  return ctx;
}
