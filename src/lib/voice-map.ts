/**
 * Mapping AR character archetype → ElevenLabs voice_id.
 *
 * RÈGLE D'OR (2026-06-24) : **la voix suit l'image**. Le genre de la voix
 * ElevenLabs DOIT correspondre au genre du sprite affiché à l'écran. Avant, les
 * blocs de narration (énigme/anecdote/histoire) étaient lus par la voix
 * "narrator" (Dallin, homme) même quand le sprite du stop était une femme
 * (guide_female) → voix homme sur image femme. Corrigé : voiceFor + voix de
 * narrateur sont genrées via ARCHETYPE_GENDER, et les overrides de langue
 * (ja/ko/zh) sont eux aussi gender-aware.
 *
 * Resolution order in voiceFor(archetype, language):
 *   1. LANGUAGE_OVERRIDES[language][gender]    — native voice if curated for this lang+gender
 *   2. ARCHETYPE_VOICES[archetype]             — character-specific voice (already gendered)
 *   3. DEFAULT_VOICE_ID                        — global fallback (Dallin)
 */
import { DEFAULT_VOICE_ID } from "@/lib/elevenlabs";

/**
 * Per-language overrides — GENDER-AWARE. When the player buys in one of these
 * languages, audio uses a native-sounding voice instead of the universal
 * Multilingual v2 voice. An override is only applied for a gender if a native
 * voice of that gender is curated; otherwise we fall back to the archetype
 * voice (multilingual v2, already at the correct gender).
 */
const LANGUAGE_OVERRIDES: Record<string, { male?: string; female?: string }> = {
  ja: { male: "f7UUeltR22mzvXAsYavl" }, // Yoshio - Calm Japanese Narrator (male)
  ko: { male: "36g0LZWoT8jWnUnnCauK" }, // Eun-joong - Korean Narrator (male)
  zh: { male: "aKCHSFIIwPcohrgtKRE4" }, // Liu - Mandarin Audiobook Narrator (male)
};

/**
 * Genre de chaque archétype = genre du SPRITE affiché. La voix DOIT suivre.
 * Tout archétype absent → "male" (Dallin), le défaut neutre OddballTrip.
 */
const ARCHETYPE_GENDER: Record<string, "male" | "female"> = {
  guide_male: "male", guide_female: "female",
  knight: "male", soldier: "male", monk: "male", sailor: "male",
  detective: "male", peasant: "male", viking: "male", ghost: "male",
  scholar: "male", narrator: "male", default: "male",
  witch: "female", princess: "female",
};

/**
 * Per-archetype voices (Multilingual v2/v3, compatibles Flash 2.5).
 *   knight/soldier → Arnold (M) · monk → Brian (M) · sailor → Daniel (M)
 *   detective/peasant → Antoni (M) · ghost → George (M)
 *   witch/princess → Charlotte (F) · guide_female → Charlotte (F)
 *   narrator/guide_male/default → Dallin (M)
 */
const ARCHETYPE_VOICES: Record<string, string> = {
  knight: "VR6AewLTigWG4xSOukaG",        // Arnold
  witch: "XB0fDUnXU5powFXDhCwa",         // Charlotte (F)
  monk: "nPczCjzI2devNBz1zQrb",          // Brian
  sailor: "onwK4e9ZLuTAKqWW03F9",        // Daniel
  detective: "ErXwobaYiN019PkySvjV",     // Antoni
  ghost: "JBFqnCBsd6RMkjVDRZzb",         // George
  princess: "XB0fDUnXU5powFXDhCwa",      // Charlotte (F)
  peasant: "ErXwobaYiN019PkySvjV",       // Antoni
  soldier: "VR6AewLTigWG4xSOukaG",       // Arnold
  narrator: DEFAULT_VOICE_ID,            // Dallin
  guide_male: DEFAULT_VOICE_ID,          // Dallin
  guide_female: "XB0fDUnXU5powFXDhCwa",  // Charlotte (F)
  default: DEFAULT_VOICE_ID,
};

/**
 * Voix "narrateur/guide" genrée — pour les blocs de NARRATION (énigme,
 * anecdote, histoire) lus pendant qu'un sprite est affiché. On garde un ton
 * narrateur cohérent mais au bon genre.
 */
const NARRATOR_VOICE: Record<"male" | "female", string> = {
  male: DEFAULT_VOICE_ID,            // Dallin (voix tour-guide historique)
  female: "EXAVITQu4vr4xnSDxMaL",    // Bella — narratrice calme multilingual v2
};

/** Genre du personnage (= genre du sprite). */
export function genderOf(archetype: string | null | undefined): "male" | "female" {
  if (!archetype) return "male";
  return ARCHETYPE_GENDER[archetype] ?? "male";
}

/** Override de langue respectant le genre, sinon null. */
function langOverride(language: string | undefined, gender: "male" | "female"): string | null {
  if (!language) return null;
  const o = LANGUAGE_OVERRIDES[language];
  return o?.[gender] ?? null;
}

/**
 * Voix du PERSONNAGE (dialogue AR) — sa voix d'archétype, genrée, avec override
 * de langue du bon genre quand dispo.
 */
export function voiceFor(
  archetype: string | null | undefined,
  language?: string,
): string {
  const gender = genderOf(archetype);
  const override = langOverride(language, gender);
  if (override) return override;
  if (!archetype) return ARCHETYPE_VOICES.default;
  return ARCHETYPE_VOICES[archetype] || ARCHETYPE_VOICES.default;
}

/**
 * Voix de NARRATION pour un stop — ton narrateur, mais du même genre que le
 * sprite affiché (`archetype`). C'est la correction du décalage voix/image.
 */
export function narratorVoiceFor(
  archetype: string | null | undefined,
  language?: string,
): string {
  const gender = genderOf(archetype);
  const override = langOverride(language, gender);
  if (override) return override;
  return NARRATOR_VOICE[gender];
}
