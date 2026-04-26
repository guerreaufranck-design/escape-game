/**
 * AR Sprite registry — source of truth for which character sprites are
 * available in the Supabase `ar-sprites` bucket and how to map them to
 * URLs.
 *
 * Used by:
 *  - the player UI (`ARCharacterSpeaker`) to render the right PNG per pose
 *  - the generation pipeline prompt to constrain Claude's character pick
 *
 * As we ship more sprites, just append new entries here — the rest of the
 * stack picks them up automatically.
 */
export type ARPose =
  | "idle"
  | "talking"
  | "pointing"
  | "thinking"
  | "surprised";

export const AR_POSES: ARPose[] = [
  "idle",
  "talking",
  "pointing",
  "thinking",
  "surprised",
];

/**
 * Catalogue of character types that have a complete 5-pose sprite set
 * uploaded. The pipeline must only pick from this list.
 *
 * `bestFor` lists the SITE TYPES + KEYWORDS that strongly match this
 * archetype. They're the primary signal Claude uses when picking. Always
 * prefer SITE TYPE over secondary theme (e.g. a corsair buried in a
 * monastery is still a "monk" location because the building is religious).
 *
 * `avoid` lists situations where this character is a wrong fit even
 * though it might superficially sound right.
 */
export const AR_CHARACTERS = [
  {
    type: "knight",
    description:
      "armoured medieval knight or crusader, royal/military authority figure",
    bestFor:
      "CASTLES, FORTRESSES, ARMOURIES, BATTLEFIELDS, ROYAL PALACES, COLONIAL GOVERNORS' RESIDENCES, MILITARY ORDERS, COURTHOUSES OF MEDIEVAL/COLONIAL ERA, ramparts, watchtowers with military function",
    avoid:
      "religious sites (use monk), maritime sites (use sailor), modern buildings",
  },
  {
    type: "witch",
    description: "mystic crone, sorceress or alchemist",
    bestFor:
      "PLAGUE MEMORIALS, INQUISITION SITES, BURNING-PLACE PLAZAS, ALCHEMICAL/HERBALIST HERITAGE, FOLKLORE LANDMARKS, sites of persecutions, occult legends, sites tied to magic or curses, witch trials, apothecaries",
    avoid:
      "neutral churches (use monk), military sites (use knight), hauntings without magic theme (use ghost)",
  },
  {
    type: "monk",
    description: "robed religious figure (Christian, Buddhist, etc.)",
    bestFor:
      "CHURCHES, CATHEDRALS, ABBEYS, MONASTERIES, CONVENTS, SANCTUARIES, CHAPELS, RELIQUARIES, SEMINARIES, scriptoriums, religious heritage of any era. CRITICAL: a religious building always wins this slot, even if a corsair is buried there or a treasure is hidden inside.",
    avoid: "secular sites with only superficial religious symbolism",
  },
  {
    type: "sailor",
    description: "naval officer, mariner, harbourmaster, corsair captain",
    bestFor:
      "PORTS, HARBOURS, DOCKS, MARINAS, LIGHTHOUSES, FAROS, MUELLES, SHIPYARDS, NAVAL ARSENALS, CORSAIRS' HOUSES, CAPTAINS' RESIDENCES, FISH MARKETS, customs houses, maritime museums, naval heroes' monuments. Use this on any port-city step that's about sea trade or corsairs.",
    avoid:
      "religious tombs of corsairs (use monk for the building, NOT sailor), inland fortifications (use knight)",
  },
  {
    type: "detective",
    description: "Victorian / early-20c sleuth in trench coat or top hat",
    bestFor:
      "1850-1940 MYSTERIES, NOIR ATMOSPHERES, URBAN CRIME LEGENDS of that era, detective stories, true-crime monuments, espionage sites, art-nouveau/art-deco buildings tied to a mystery",
    avoid: "anything pre-1850 or post-1950, religious sites, ports",
  },
  {
    type: "ghost",
    description: "spectral apparition of a deceased figure",
    bestFor:
      "TOMBS, CEMETERIES, MAUSOLEUMS, CRYPTS, OSSUARIES, ABANDONED RUINS, BATTLEFIELD MEMORIALS, sites of tragic deaths, haunted hotels, ancestor cults. Use sparingly — only when the step's PRIMARY signal is death or haunting, not just because someone famous died nearby.",
    avoid:
      "religious buildings where a famous person is buried (use monk), corsair sites (use sailor unless the SITE itself is a tomb)",
  },
] as const;

export type ARCharacterType = (typeof AR_CHARACTERS)[number]["type"];

/** Fallback characters used when no thematic match exists. */
export const AR_FALLBACK_CHARACTERS = ["guide_male", "guide_female"] as const;
export type ARFallbackCharacter = (typeof AR_FALLBACK_CHARACTERS)[number];

/** Every character (themed + fallback) that has sprites in the bucket. */
export const ALL_AR_CHARACTERS: readonly string[] = [
  ...AR_CHARACTERS.map((c) => c.type),
  ...AR_FALLBACK_CHARACTERS,
];

const BUCKET_BASE =
  "https://sijpbarxxcdkodhfrdyx.supabase.co/storage/v1/object/public/ar-sprites";

/**
 * Build the public URL for a given character + pose.
 * If the character isn't in the catalogue, falls back to `guide_male`.
 */
export function getSpriteUrl(
  characterType: string | null | undefined,
  pose: ARPose = "idle",
): string {
  const type =
    characterType && ALL_AR_CHARACTERS.includes(characterType)
      ? characterType
      : "guide_male";
  return `${BUCKET_BASE}/${type}_${pose}.png`;
}

/**
 * Picks a fallback guide based on a stable seed (e.g. step id) so the
 * same step always renders the same guide rather than flickering.
 */
export function pickFallbackGuide(seed: string): ARFallbackCharacter {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AR_FALLBACK_CHARACTERS[Math.abs(hash) % AR_FALLBACK_CHARACTERS.length];
}

/**
 * Format the character catalogue for a Claude prompt. Each entry includes
 * the description, which sites/themes match it best, and pitfalls to avoid.
 */
export function formatCharactersForPrompt(): string {
  const lines = AR_CHARACTERS.map(
    (c) =>
      `  - "${c.type}" — ${c.description}\n      best for: ${c.bestFor}\n      avoid: ${c.avoid}`,
  ).join("\n");
  return `AVAILABLE CHARACTER TYPES:\n${lines}\n  - "default" — neutral OddballTrip guide. Use ONLY when none of the themed characters fits the step's setting (e.g. modern museums, civic buildings of the late 20c, neutral squares).`;
}

/**
 * Build the full character-selection block for a Claude prompt:
 * a deterministic procedure, a strict diversity mandate, and the
 * character catalogue. Keeps the diversity rule co-located with the
 * catalogue so the LLM never sees one without the other.
 */
export function buildCharacterSelectionGuidance(stepCount: number): string {
  const targetVariety = Math.min(stepCount, AR_CHARACTERS.length);
  return `CHARACTER SELECTION PROCEDURE — apply for EACH step:
  1. Identify the SITE TYPE: church / fortress / port / cemetery / palace / market / lighthouse / watchtower / convent / etc. The SITE TYPE is the primary signal — it almost always determines the character.
  2. Identify the ERA: medieval / renaissance / 18th-c / 19th-c / 1920s / modern.
  3. Identify the THEME: justice, faith, war, trade, magic, death, exploration, mystery.
  4. Pick the character whose "best for" list most directly matches (1)+(2)+(3). The SITE TYPE wins ties.

DIVERSITY MANDATE — STRICT:
  - Across the ${stepCount} steps of this game, use AS MANY DIFFERENT character archetypes as the storyline plausibly allows.
  - Target: at least ${targetVariety} DISTINCT character types across the ${stepCount} steps.
  - NEVER repeat the same character on two consecutive steps unless they share an EXACT setting + era + theme triplet.
  - If you find yourself reaching for the same character a 2nd time, STOP and reconsider — there is almost always a better thematic alternative in the catalogue.
  - "default" is a last resort — only when NO themed character fits.

${formatCharactersForPrompt()}`;
}
