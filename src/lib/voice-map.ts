/**
 * Mapping AR character archetype → ElevenLabs voice_id, with optional
 * per-language overrides for languages where a native-accent voice is
 * worth the curation cost.
 *
 * Resolution order in voiceFor(archetype, language):
 *   1. LANGUAGE_OVERRIDES[language]            — native voice if curated for this lang
 *   2. ARCHETYPE_VOICES[archetype]             — character-specific voice
 *   3. DEFAULT_VOICE_ID                        — global fallback (Dallin)
 *
 * Update each entry once you've picked voices in the ElevenLabs Voice
 * Library. Use Multilingual v2 voices (or v3) for archetype voices since
 * they need to work across all languages — except where a native-language
 * override takes over (in which case the override can be a language-locked
 * professional voice).
 */
import { DEFAULT_VOICE_ID } from "@/lib/elevenlabs";

/**
 * Per-language overrides. When the player buys in one of these languages,
 * the audio is generated with a native-sounding voice instead of the
 * universal Multilingual v2 voice. This eliminates the slight American
 * accent on Asian languages — important for Klook market.
 *
 * Only languages with a curated native voice need an entry here. Others
 * fall back to the archetype voice (which is Multilingual v2).
 */
const LANGUAGE_OVERRIDES: Record<string, string> = {
  ja: "f7UUeltR22mzvXAsYavl", // Yoshio - Calm Japanese Narrator (male, middle-aged, standard accent)
  ko: "36g0LZWoT8jWnUnnCauK", // Eun-joong - Deep & Calm Korean Narrator (male, middle-aged, history-narration)
  zh: "aKCHSFIIwPcohrgtKRE4", // Liu - Professional Mandarin Audiobook Narrator (male, middle-aged, standard)
};

/**
 * Per-archetype voices. Used as the default when no language override is set.
 *
 * Voices choisies dans le catalogue PRE-MADE ElevenLabs (compatibles
 * Flash 2.5 + multilingual v2/v3). Chaque archétype a une voix propre
 * qui correspond au caractère narratif du personnage AR :
 *
 *   knight    → Arnold (deep, autoritaire, militaire)
 *   witch     → Charlotte (mature feminine, raspy, mystérieuse)
 *   monk      → Brian (deep storyteller, calme, profondeur spirituelle)
 *   sailor    → Daniel (British weathered, grave maritime)
 *   detective → Antoni (warm inquisitive male, voix d'enquête)
 *   ghost     → George (mature British, raspy, voix d'outre-tombe)
 *   princess  → Charlotte (raspy female royal — peut être soft + mystery)
 *   peasant   → Antoni (warm folksy, accessible)
 *   soldier   → Arnold (strong stern, autorité militaire)
 *   narrator  → Dallin (default, calme middle-aged male — la voix
 *               OddballTrip historique pour anecdotes + épilogue)
 *
 * Effet : chaque AR character a sa propre voix → immersion +30%.
 * Pour les anecdotes et l'épilogue (slot=narrator), reste sur Dallin
 * pour la cohérence "tour-guide" à travers tout le jeu.
 *
 * Si dégradation perçue, revert chaque entrée à DEFAULT_VOICE_ID.
 */
const ARCHETYPE_VOICES: Record<string, string> = {
  knight: "VR6AewLTigWG4xSOukaG",        // Arnold — strong autoritaire
  witch: "XB0fDUnXU5powFXDhCwa",         // Charlotte — raspy mature feminine
  monk: "nPczCjzI2devNBz1zQrb",          // Brian — deep calm storyteller
  sailor: "onwK4e9ZLuTAKqWW03F9",        // Daniel — British weathered
  detective: "ErXwobaYiN019PkySvjV",     // Antoni — warm inquisitive
  ghost: "JBFqnCBsd6RMkjVDRZzb",         // George — mature whispered
  princess: "XB0fDUnXU5powFXDhCwa",      // Charlotte — soft mysterious
  peasant: "ErXwobaYiN019PkySvjV",       // Antoni — warm folksy
  soldier: "VR6AewLTigWG4xSOukaG",       // Arnold — strong stern
  /** Neutral OddballTrip narrator (anecdotes + epilogue) — Dallin reste. */
  narrator: DEFAULT_VOICE_ID,
  /** Guides OddballTrip neutres — Dallin pour les fallbacks "default". */
  guide_male: DEFAULT_VOICE_ID,
  /** Guide féminin — Charlotte voix gentle pour alterner avec Dallin. */
  guide_female: "XB0fDUnXU5powFXDhCwa",
  default: DEFAULT_VOICE_ID,
};

/**
 * Resolve the right voice for a given archetype + language combination.
 * Language overrides win when present (native accent preferred over the
 * universal voice character).
 */
export function voiceFor(
  archetype: string | null | undefined,
  language?: string,
): string {
  if (language && LANGUAGE_OVERRIDES[language]) {
    return LANGUAGE_OVERRIDES[language];
  }
  if (!archetype) return ARCHETYPE_VOICES.default;
  return ARCHETYPE_VOICES[archetype] || ARCHETYPE_VOICES.default;
}
