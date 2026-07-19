/**
 * SELECT v5 — Claude Sonnet 4.5 choisit les 8 best parmi le pool géocodé.
 *
 * Le rôle de Claude : raisonnement sémantique. Il reçoit :
 *   - le pool de landmarks géocodés (nom Perplexity + nom Google + GPS + distance start)
 *   - le scénario complet du buyer
 *   - le mode de transport + rayon
 * Et il choisit :
 *   - TARGET_STOPS (8) — ou MIN_STOPS (5) si vraiment pas possible
 *   - en respectant la qualité city-tour (cf. config)
 *   - en triant en ordre de parcours optimal
 *
 * Output : SelectionResult avec les landmarks choisis (sous-ensemble du pool,
 * dans l'ordre de visite). PAS de riddle/answer/anecdote ici — c'est narrate
 * qui les écrira.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "./config";
import { optimizeRoute, routeLengthM } from "./route-optimize";
import type { GeocodeResult, GeocodedLandmark, PipelineInput } from "./types";

export interface SelectionResult {
  selected: GeocodedLandmark[];
  rationale: string;
  rawMarkdown: string;
}

/** Compute median of an array of numbers. */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function buildSelectionPrompt(input: PipelineInput, geocode: GeocodeResult): string {
  const pool = geocode.geocoded
    .map(
      (g, i) =>
        `${i + 1}. "${g.name}"
   - Google name: "${g.googleName}"
   - GPS: ${g.lat}, ${g.lon}
   - Distance from start: ${g.distanceFromStartM} m
   - Description (from research): ${g.narrativeTitle ?? "(none)"}`,
    )
    .join("\n\n");

  // ANTI-OUTLIER (2026-05-27) : on calcule la distance médiane du pool
  // pour donner à Claude un seuil concret. Bug observé Vianden 27/05 :
  // 7 stops dans cluster <400m, 8e stop à 754m (barrage) = outlier
  // thématique forcé. Cette consigne guide Claude à éviter ces sauts.
  const dists = geocode.geocoded.map((g) => g.distanceFromStartM ?? 0);
  const medianDist = Math.round(median(dists));
  const outlierThreshold = Math.round(medianDist * 3);

  // Detect if pool index 0 is a forced start point (marked by runGeocode)
  const hasForcedStart =
    geocode.geocoded.length > 0 &&
    geocode.geocoded[0].narrativeTitle?.includes("[FORCED START]");
  const forcedStartBlock = hasForcedStart
    ? `\n## NON-NEGOTIABLE constraint — FIRST STOP IS LOCKED

The buyer explicitly chose **candidate #1 ("${geocode.geocoded[0].googleName}")** as their starting landmark. This is what they will see on their map as "your starting point" and what they will physically arrive at.

**You MUST place candidate #1 as your step_order=1.** Do not skip it. Do not reorder it. Pick ${CONFIG.TARGET_STOPS - 1} additional landmarks for steps 2 through ${CONFIG.TARGET_STOPS}, ordered for an optimal route from the forced start.
`
    : "";

  return `You are selecting the landmarks for an outdoor escape game / city tour in ${input.city}${
    input.country ? `, ${input.country}` : ""
  }.${forcedStartBlock}

## Scenario (buyer-provided, English-native)

**Theme**: ${input.theme}
**Brief**: ${input.themeDescription ?? "(none)"}
**Role-play**: ${input.productDescription ?? "(none)"}
**Narrative direction**: ${input.narrative ?? "(none)"}

## Geographic context

- Start point: ${input.startPoint.lat}, ${input.startPoint.lon}
- Transport mode: ${input.transportMode}
- Search radius: ${input.radiusKm} km
- Estimated total duration: ${input.estimatedDurationMin} minutes

## Verified landmark pool (${geocode.geocoded.length} candidates, all geocoded by Google Maps)

${pool}

## Your task — CITY-TOUR FIRST philosophy

This product is FIRST a city-tour (tourist discovers the city's heritage), SECOND a thematic game (narrative woven on top). Therefore prioritize **city-tour quality**, not strict thematic fit.

**Pick exactly ${CONFIG.TARGET_STOPS} landmarks** (fallback ${CONFIG.MIN_STOPS} minimum if pool too small) following this priority order :

1. **City-tour quality** : pick the heritage that a tourist MUST see in this city
2. **Geographic coherence** : design a smooth visit route (no zigzag, respect transport mode and duration)
3. **Variety** : mix iconic + lesser-known if both are heritage-grade
4. **Thematic relevance** : tiebreaker only — used to rank between two equally important sites

## ANTI-OUTLIER RULE (geographic discipline)

Pool median distance from start : **${medianDist}m**. Outlier threshold (3× median) : **${outlierThreshold}m**.

- STRONGLY PREFER candidates within 2× the median distance (= within ${Math.round(medianDist * 2)}m of start).
- **AVOID** any candidate beyond ${outlierThreshold}m, EVEN IF it is thematically perfect. These outliers create awkward jumps in the walking/driving experience and disconnect the climax from the cluster.
- If excluding outliers leaves you with fewer than ${CONFIG.TARGET_STOPS} candidates, prefer returning ${CONFIG.MIN_STOPS} tightly-clustered stops over ${CONFIG.TARGET_STOPS} with one outlier.
- A culturally significant landmark closer to the cluster ALWAYS wins over a thematically perfect landmark far outside the cluster.

**Examples of good selection logic** :
- Étretat theme Lupin → pick Falaise d'Aval, Aiguille, Maurice Leblanc house, Manneporte even though only the last has direct Lupin link — they're THE Étretat
- Vaduz theme "WWII Regiment" → pick the Castle, Cathedral, National Museum, Town Square (these are Vaduz's main heritage), even if no direct WWII angle
- Vianden theme Hugo (small village pool) → pick the Castle, Hugo House, Hugo Monument, Trinitarian Church, Museum, Bridge banks — DO NOT include a dam 750m away just for a "modernity climax"

**Order the selection** in the optimal visit sequence (start near start point, build narrative momentum, climax near the end).

## Output (JSON only, no preamble)

\`\`\`json
{
  "selected": [
    {
      "step_order": 1,
      "name": "<verbatim name from pool>",
      "rationale": "<1 sentence why this landmark for this game>"
    },
    {
      "step_order": 2,
      "name": "<verbatim>",
      "rationale": "<1 sentence>"
    },
    ... (up to ${CONFIG.TARGET_STOPS})
  ],
  "rationale": "<2-3 sentences explaining the route logic>"
}
\`\`\`

The "name" field MUST exactly match a landmark in the pool (use the exact name or Google name verbatim). The narration step uses these names to retrieve GPS coords — no invention.`;
}

export async function runSelect(
  input: PipelineInput,
  geocode: GeocodeResult,
): Promise<SelectionResult> {
  if (geocode.geocoded.length === 0) {
    throw new Error("Select: no geocoded landmarks to choose from");
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log(
    `[v5 select] Claude ${CONFIG.CLAUDE_MODEL} sélectionne ${CONFIG.TARGET_STOPS} best parmi ${geocode.geocoded.length}`,
  );
  const t0 = Date.now();
  const prompt = buildSelectionPrompt(input, geocode);
  const response = await client.messages.create({
    model: CONFIG.CLAUDE_MODEL,
    max_tokens: 3000,
    temperature: CONFIG.CLAUDE_TEMPERATURE,
    messages: [{ role: "user", content: prompt }],
  });
  const dur = Math.round((Date.now() - t0) / 1000);

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Select response not parseable. Preview: ${text.slice(0, 300)}`);
  }

  let parsed: { selected: Array<{ step_order: number; name: string; rationale: string }>; rationale: string };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Select JSON parse failed: ${e instanceof Error ? e.message : "?"}`);
  }

  if (!Array.isArray(parsed.selected) || parsed.selected.length < CONFIG.MIN_STOPS) {
    throw new Error(
      `Select returned only ${parsed.selected?.length ?? 0} landmarks (need ≥${CONFIG.MIN_STOPS})`,
    );
  }

  // Map selected names back to GeocodedLandmark
  const selected: GeocodedLandmark[] = [];
  for (const sel of parsed.selected) {
    const hit = geocode.geocoded.find(
      (g) =>
        g.name === sel.name ||
        g.googleName === sel.name ||
        g.name.toLowerCase() === sel.name.toLowerCase() ||
        g.googleName.toLowerCase() === sel.name.toLowerCase(),
    );
    if (hit) {
      selected.push({ ...hit, order: sel.step_order, narrativeTitle: sel.rationale });
    } else {
      console.warn(`[v5 select] Claude a renvoyé "${sel.name}" introuvable dans le pool — skip`);
    }
  }

  if (selected.length < CONFIG.MIN_STOPS) {
    throw new Error(
      `Select : après matching back au pool, seulement ${selected.length}/${parsed.selected.length} landmarks valides`,
    );
  }

  // ── ANTI-OUTLIER detection (post-select log) ──
  // On vérifie que Claude a respecté la consigne anti-outlier du prompt.
  // Si non, on log un warning pour traçabilité (mais on ne prune pas
  // automatiquement — l'opérateur peut décider après review).
  const selDists = selected.map((s) => s.distanceFromStartM ?? 0);
  const selMedian = median(selDists);
  const outlierThresh = selMedian * 3;
  const outliers = selected.filter((s) => (s.distanceFromStartM ?? 0) > outlierThresh && selMedian > 50);
  if (outliers.length > 0) {
    console.warn(
      `[v5 select] ⚠️ ${outliers.length} OUTLIER(S) detected (>${Math.round(outlierThresh)}m, median=${Math.round(selMedian)}m): ${outliers.map((o) => `"${o.name}" @${o.distanceFromStartM}m`).join(", ")}. Claude a ignoré l'anti-outlier rule — opérateur peut éditer le draft post-publish.`,
    );
  } else {
    console.log(
      `[v5 select] ✓ no outliers (median=${Math.round(selMedian)}m, all within 3× = ${Math.round(outlierThresh)}m)`,
    );
  }

  // ── Safety : enforce forced start at position 1, même si Claude a ignoré ──
  // Le prompt demande explicitement à Claude de mettre le forced start à
  // step_order=1. Mais on ne fait JAMAIS confiance aveugle au LLM — si Claude
  // l'a déplacé en 2e/3e position, ou retiré, on le réinjecte de force.
  const forcedStart = geocode.geocoded[0];
  if (forcedStart?.narrativeTitle?.includes("[FORCED START]")) {
    const currentIdx = selected.findIndex((s) => s.placeId === forcedStart.placeId);
    if (currentIdx === -1) {
      // Claude l'a complètement retiré → on le réinjecte en tête + on retire le dernier
      console.warn(
        `[v5 select] Claude a IGNORÉ le forced start "${forcedStart.googleName}" — réinjection en step_order=1 (drop du dernier de sa sélection)`,
      );
      selected.unshift({ ...forcedStart, order: 1 });
      if (selected.length > CONFIG.TARGET_STOPS) selected.pop();
    } else if (currentIdx !== 0) {
      // Claude l'a déplacé → on le swap en première position
      console.warn(
        `[v5 select] Claude a placé le forced start en step_order=${currentIdx + 1} au lieu de 1 — swap`,
      );
      const [start] = selected.splice(currentIdx, 1);
      selected.unshift({ ...start, order: 1 });
    }
    // Re-numbering pour rester cohérent
    for (let i = 0; i < selected.length; i++) {
      selected[i] = { ...selected[i], order: i + 1 };
    }
  }

  // ── ANTI-DOUBLON (2026-07-18) — petites villes ──
  // Peu de landmarks distincts → le LLM peut RÉPÉTER le même lieu (ex. Los
  // Cristianos : Plaza de la iglesia en stop 1 ET 8). On dédoublonne par
  // placeId (à défaut coords arrondies) — garde la 1ʳᵉ occurrence.
  {
    const seen = new Set<string>();
    const unique: typeof selected = [];
    for (const st of selected) {
      const key = st.placeId || `${st.lat.toFixed(5)},${st.lon.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(st);
    }
    if (unique.length < selected.length) {
      console.warn(
        `[v5 select] ⚠️ ${selected.length - unique.length} doublon(s) de landmark retiré(s) (petite ville) — ${unique.length} lieux distincts`,
      );
      selected.length = 0;
      selected.push(...unique);
    }
  }

  // ── Route optimization (2026-06-08) — déterministe, post-LLM ──
  // Claude choisit BIEN les landmarks mais ordonne MAL la route (il raisonne la
  // géographie au lieu de la calculer → zigzags, ex. Boston Old North→Tea Party).
  // On garde son choix et on confie l'ORDRE à un calcul : plus-proche-voisin +
  // 2-opt, départ (step 1) figé. Le dernier stop du chemin optimal = climax.
  const beforeLen = routeLengthM(selected);
  const optimized = optimizeRoute(selected);
  for (let i = 0; i < optimized.length; i++) optimized[i] = { ...optimized[i], order: i + 1 };
  const afterLen = routeLengthM(optimized);
  if (afterLen + 1 < beforeLen) {
    console.log(
      `[v5 select] route optimized: ${Math.round(beforeLen)}m → ${Math.round(afterLen)}m ` +
        `(−${Math.round(beforeLen - afterLen)}m) : ${optimized.map((s) => s.googleName || s.name).join(" → ")}`,
    );
  } else {
    console.log(`[v5 select] route already optimal (${Math.round(beforeLen)}m), ordre Claude conservé`);
  }
  selected.length = 0;
  selected.push(...optimized);

  console.log(`[v5 select] Claude done in ${dur}s — ${selected.length} sélectionnés`);
  return {
    selected,
    rationale: parsed.rationale,
    rawMarkdown: text,
  };
}
