/**
 * Thematic landmark proposer (Sprint I, 2026-05-22).
 *
 * ═══════════════════════════════════════════════════════════════════
 * Purpose — close the niche-theme pool gap
 * ═══════════════════════════════════════════════════════════════════
 *
 * Béziers Cathars V4 (22/05 18:23) revealed that even with :
 *   - Google nearbysearch (60 candidates)
 *   - Perplexity Deep Research iconicSites enrichment (Sprint A)
 *
 * The canonical theme sites WERE STILL MISSING from the pool :
 *   - Cathédrale Saint-Nazaire (massacre 1209 hub)
 *   - Église de la Madeleine (7000 burned alive)
 *   - Tour Pépézuc, ramparts médiévaux
 *
 * Perplexity DR sometimes lists "thematic categories" (medieval
 * churches, fortifications) without the SPECIFIC monument names a
 * Béziers expert would name. The Google nearbysearch surfaces what
 * tourists rate, not what historians cite.
 *
 * This module adds a THIRD enrichment source : Claude Haiku reads
 * the theme + themeDescription + productDescription + city, and
 * PROPOSES specific physical landmark names a knowledgeable historian
 * would associate with this theme in this city. Each proposal is then
 * geocoded via Google Places findPlaceFromText (anti-hallucination
 * guard : invented names fail the lookup silently).
 *
 * Trust contract :
 *   - Claude can ONLY propose names. The Google API decides if they're
 *     real. Hallucinations fail the lookup → silently dropped.
 *   - The findPlaceFromText filter (`isAcceptablePlaceType`) handles
 *     bogus types (routes, tunnels, etc.)
 *
 * "Qui peut le plus peut le moins" (the user's argument 22/05) :
 *   - If Béziers Cathars passes, 95% of games pass.
 *   - This module is the missing link to unblock niche historic themes.
 *
 * Cost : ~$0.004 per game (one Haiku call, ≤ 8 landmark proposals).
 */
import Anthropic from "@anthropic-ai/sdk";

export interface LandmarkProposal {
  name: string;
  rationale: string;
}

export interface ProposeLandmarksInput {
  city: string;
  country: string;
  theme: string;
  themeDescription: string;
  productDescription?: string;
  /** Names already in the pool — Claude is told to AVOID re-proposing
   *  these (we want NEW additions, not duplicates). */
  existingPoolNames: string[];
  /** Max landmarks to propose (default 8). */
  maxProposals?: number;
}

const SYSTEM_PROMPT = `You are a heritage historian who knows the specific monuments, churches, gates, towers, and squares tied to a given historic theme in a given city.

Your job : when handed a theme + city, propose 6-8 SPECIFIC physical landmarks (by their real name) that a historian would NAME as canonical sites for this theme in this city.

═══════════════════════════════════════════════════════════
WHAT TO PROPOSE
═══════════════════════════════════════════════════════════

  ✅ NAMED, PHYSICAL, STILL-STANDING landmarks :
       - Cathedrals, basilicas, churches, abbeys, monasteries
       - Towers, gates, ramparts, walls
       - Castles, forts, palaces
       - Bridges, fountains, monuments, statues
       - Historic squares (named ones with documented role)
       - Famous houses / hôtels particuliers tied to figures

  ✅ Use the FULL geocodable name as it would appear on Google Maps :
       "Cathédrale Saint-Nazaire de Béziers" (NOT just "the cathedral")
       "Église de la Madeleine de Béziers" (NOT just "Madeleine church")
       "Tour de Constance" (NOT just "the tower")

  ✅ Prioritize sites with DOCUMENTED ties to the theme's event/era/figure.
     Even tertiary ties (a monastery that LATER housed a relevant
     order) are valuable — the thematic judge downstream decides
     which actually scores high.

═══════════════════════════════════════════════════════════
WHAT NOT TO PROPOSE
═══════════════════════════════════════════════════════════

  ❌ Generic categories ("a medieval church") — must be named
  ❌ Modern museums about the theme (UNLESS the museum is iconic,
     like a Caravaggio museum for a Caravaggio theme)
  ❌ Reconstructions / replicas
  ❌ Landmarks in OTHER cities (Carcassonne sites for a Béziers game)
  ❌ Hallucinated/imaginary sites — only propose what you know exists

═══════════════════════════════════════════════════════════
OUTPUT FORMAT — strict JSON
═══════════════════════════════════════════════════════════

{
  "landmarks": [
    {
      "name": "<full geocodable name with city if needed>",
      "rationale": "<one sentence : why this site for this theme>"
    },
    ... up to 8 entries
  ]
}

CRITICAL RULES :
  - Each name MUST be geocodable on Google Maps.
  - Use proper diacritics (Saint-Nazaire, not Saint Nazaire).
  - Append ", [city]" when the name is generic ("Place de la Madeleine"
    → "Place de la Madeleine, Béziers").
  - Do NOT repeat landmarks already listed as "already in pool" in the
    user message.
  - If you don't know the city well enough to propose grounded specific
    landmarks, return an empty list rather than hallucinate.
  - Prefer OUTDOOR landmarks (façade-visible heritage) over indoor
    museums — outdoor escape-game UX.`;

function buildUserPrompt(input: ProposeLandmarksInput): string {
  const pdBlock =
    input.productDescription && input.productDescription.length > 50
      ? `\nPRODUCT-PAGE DESCRIPTION (rich context — the operator's promise to the customer) :\n"""${input.productDescription.trim()}"""\n`
      : "";

  const existingBlock = input.existingPoolNames.length > 0
    ? `\nALREADY IN POOL (do NOT re-propose, we want NEW additions) :\n${input.existingPoolNames.slice(0, 50).map((n) => `- ${n}`).join("\n")}\n`
    : "";

  return `THEME : "${input.theme}"
THEME DESCRIPTION : ${input.themeDescription}
CITY : ${input.city}, ${input.country}
${pdBlock}${existingBlock}
Propose up to ${input.maxProposals ?? 8} SPECIFIC physical landmarks (named, geocodable) tied to this theme in this city. Return JSON only.`;
}

export async function proposeThematicLandmarks(
  input: ProposeLandmarksInput,
): Promise<LandmarkProposal[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1500,
    temperature: 0.2, // slight variance helps Claude propose less-obvious sites
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const jsonText = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `Landmark proposer returned non-JSON: ${err instanceof Error ? err.message : err} — body: ${text.slice(0, 200)}`,
    );
  }
  const p = parsed as { landmarks?: unknown };
  if (!Array.isArray(p.landmarks)) return [];

  const proposals: LandmarkProposal[] = [];
  for (const item of p.landmarks) {
    const r = (item ?? {}) as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const rationale = typeof r.rationale === "string" ? r.rationale.trim() : "";
    if (name.length < 3) continue;
    // Dedup by lowercased name
    if (proposals.find((pp) => pp.name.toLowerCase() === name.toLowerCase()))
      continue;
    proposals.push({ name, rationale });
  }
  return proposals;
}
