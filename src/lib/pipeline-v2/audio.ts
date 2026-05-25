/**
 * AUDIO — ElevenLabs Flash v2.5, multi-voix par character + multi-lang.
 *
 * Architecture :
 *   - Pour chaque langue traduite, pour chaque stop, on génère :
 *     - 1 audio "riddle" (voix narrateur default)
 *     - 1 audio "character" (voix de l'archétype AR : monk, scholar, soldier...)
 *     - 1 audio "anecdote" (voix narrateur default)
 *   - + 1 audio "intro" + 1 audio "epilogue" par langue
 *   - Fichiers uploadés dans Supabase Storage (bucket "audio")
 *   - Cache dans audio_cache (table) pour réutilisation
 *
 * Vitesse : 1.0 par défaut (1.1 sur MSM en raison du tempo lent).
 */

import { createClient } from "@supabase/supabase-js";
import type { AudioResult, StructuredGame, TranslationResult } from "./types";

const ELEVEN_API = "https://api.elevenlabs.io/v1";
const MODEL_ID = "eleven_flash_v2_5";
const STORAGE_BUCKET = "audio";
const DEFAULT_VOICE = "alFofuDn3cOwyoz1i44T"; // Dallin

const ARCHETYPE_VOICES: Record<string, string> = {
  guide_male: DEFAULT_VOICE,
  guide_female: "EXAVITQu4vr4xnSDxMaL", // Bella (female warm)
  scholar: "21m00Tcm4TlvDq8ikWAM", // Rachel
  monk: "nPczCjzI2devNBz1zQrb", // Adam-like, contemplative
  soldier: "VR6AewLTigWG4xSOukaG", // Josh, deeper
};

interface GenerateOptions {
  /** Vitesse de lecture (1.0 default, 1.1 sur MSM). */
  speed?: number;
  /** Voice ID override (sinon archetype-based ou DEFAULT). */
  voiceId?: string;
}

async function ttsToBuffer(
  text: string,
  voiceId: string,
  language: string,
  speed: number,
): Promise<Buffer> {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY missing");

  const res = await fetch(`${ELEVEN_API}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        speed,
      },
      language_code: language,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs error ${res.status}: ${errText.slice(0, 200)}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uploadToSupabaseStorage(
  s: any,
  buffer: Buffer,
  storagePath: string,
): Promise<string> {
  const { error: uploadErr } = await s.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, { contentType: "audio/mpeg", upsert: true });
  if (uploadErr) throw new Error(`Storage upload failed for ${storagePath}: ${uploadErr.message}`);
  const { data: pub } = s.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  return pub.publicUrl;
}

/**
 * Génère tous les audios pour un jeu + une langue.
 *
 * Files créés : intro, epilogue, et pour chaque stop : riddle, character,
 * anecdote.
 */
export async function generateAudioForLanguage(
  gameId: string,
  game: StructuredGame,
  translation: TranslationResult,
  options: GenerateOptions = {},
): Promise<AudioResult> {
  const speed = options.speed ?? 1.0;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  const s = createClient(url, key);

  const files: AudioResult["files"] = [];

  // Intro
  const introBuf = await ttsToBuffer(
    translation.meta.intro,
    DEFAULT_VOICE,
    translation.language,
    speed,
  );
  const introPath = `games/${gameId}/${translation.language}/intro.mp3`;
  const introUrl = await uploadToSupabaseStorage(s, introBuf, introPath);
  files.push({
    stepOrder: 0,
    slot: "intro",
    storagePath: introPath,
    publicUrl: introUrl,
    duration: 0, // could be computed via ffprobe, skipped for MVP
  });

  // Epilogue
  const epiBuf = await ttsToBuffer(
    translation.meta.epilogue,
    DEFAULT_VOICE,
    translation.language,
    speed,
  );
  const epiPath = `games/${gameId}/${translation.language}/epilogue.mp3`;
  const epiUrl = await uploadToSupabaseStorage(s, epiBuf, epiPath);
  files.push({
    stepOrder: 0,
    slot: "epilogue",
    storagePath: epiPath,
    publicUrl: epiUrl,
    duration: 0,
  });

  // Per stop
  for (const stop of game.stops) {
    const tStop = translation.stops.find((t) => t.step_order === stop.step_order);
    if (!tStop) continue;
    const charVoice = ARCHETYPE_VOICES[stop.arCharacterType] ?? DEFAULT_VOICE;

    // Riddle (narrator default)
    const rBuf = await ttsToBuffer(tStop.riddle, DEFAULT_VOICE, translation.language, speed);
    const rPath = `games/${gameId}/${translation.language}/step-${stop.step_order}-riddle.mp3`;
    const rUrl = await uploadToSupabaseStorage(s, rBuf, rPath);
    files.push({ stepOrder: stop.step_order, slot: "riddle", storagePath: rPath, publicUrl: rUrl, duration: 0 });

    // Character (archetype voice)
    const cBuf = await ttsToBuffer(tStop.arCharacterDialogue, charVoice, translation.language, speed);
    const cPath = `games/${gameId}/${translation.language}/step-${stop.step_order}-character.mp3`;
    const cUrl = await uploadToSupabaseStorage(s, cBuf, cPath);
    files.push({ stepOrder: stop.step_order, slot: "character", storagePath: cPath, publicUrl: cUrl, duration: 0 });

    // Anecdote (narrator)
    const aBuf = await ttsToBuffer(tStop.anecdote, DEFAULT_VOICE, translation.language, speed);
    const aPath = `games/${gameId}/${translation.language}/step-${stop.step_order}-anecdote.mp3`;
    const aUrl = await uploadToSupabaseStorage(s, aBuf, aPath);
    files.push({ stepOrder: stop.step_order, slot: "anecdote", storagePath: aPath, publicUrl: aUrl, duration: 0 });
  }

  return { language: translation.language, files };
}

/** Génère audios pour toutes les langues en parallèle (capped concurrency à 2 pour pas saturer ElevenLabs). */
export async function generateAudioMulti(
  gameId: string,
  game: StructuredGame,
  translations: TranslationResult[],
  options: GenerateOptions = {},
): Promise<AudioResult[]> {
  // Simple sequential pour éviter rate limit ElevenLabs
  const results: AudioResult[] = [];
  for (const t of translations) {
    results.push(await generateAudioForLanguage(gameId, game, t, options));
  }
  return results;
}
