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
 * Currently every archetype routes to Dallin Storyteller — a calm middle-aged
 * male American narrator (DEFAULT_VOICE_ID). To give each character its own
 * vocal identity, replace each entry with a Multilingual v2 voice that fits
 * the archetype's vibe.
 */
const ARCHETYPE_VOICES: Record<string, string> = {
  knight: DEFAULT_VOICE_ID,
  witch: DEFAULT_VOICE_ID,
  monk: DEFAULT_VOICE_ID,
  sailor: DEFAULT_VOICE_ID,
  detective: DEFAULT_VOICE_ID,
  ghost: DEFAULT_VOICE_ID,
  princess: DEFAULT_VOICE_ID,
  peasant: DEFAULT_VOICE_ID,
  soldier: DEFAULT_VOICE_ID,
  /** Neutral OddballTrip narrator (anecdotes + epilogue). */
  narrator: DEFAULT_VOICE_ID,
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
