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
 * Keep `description` short — it's injected verbatim into the Claude prompt.
 */
export const AR_CHARACTERS = [
  {
    type: "knight",
    description: "armoured medieval knight, crusader era — fits castles, fortresses, military monuments",
  },
  {
    type: "witch",
    description: "mystic crone or sorceress — fits superstitions, plague legends, dark folklore",
  },
  {
    type: "monk",
    description: "robed religious figure — fits churches, abbeys, monasteries, religious heritage",
  },
  {
    type: "sailor",
    description: "naval officer or mariner — fits ports, lighthouses, harbours, maritime heritage",
  },
  {
    type: "detective",
    description: "Victorian/early-20c sleuth — fits 1850-1940 mysteries, detective stories",
  },
  {
    type: "ghost",
    description: "spectral apparition — fits haunted sites, cemeteries, tragic legends, corsairs",
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
 * Format the character catalogue for a Claude prompt, so the LLM can pick
 * the most thematic character type for each step.
 */
export function formatCharactersForPrompt(): string {
  const lines = AR_CHARACTERS.map(
    (c) => `  - "${c.type}": ${c.description}`,
  ).join("\n");
  return `Available character types (pick the most thematically fitting one for each step, or "default" if none fits):\n${lines}\n  - "default": neutral OddballTrip guide (use only when none of the themed characters fit the step)`;
}
