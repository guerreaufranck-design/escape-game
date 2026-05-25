/**
 * AUDIO v5 — ElevenLabs Flash v2.5, langue client UNIQUEMENT.
 *
 * Mandat user : pas d'audio spéculatif. Une seule langue par achat (celle
 * commandée). Si plus tard un autre client achète le même slug dans une
 * autre langue, on regen à ce moment-là (lazy).
 *
 * Files générés par achat :
 *   - intro_speech
 *   - epilogue
 *   - final_riddle
 *   - final_explanation
 *   - riddle, character, anecdote × N stops (= 3 × stops)
 *
 * Voix archétypes depuis CONFIG.ELEVENLABS_ARCHETYPE_VOICES.
 */

import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "./config";
import type { AudioResult, StructuredGame, TranslationResult } from "./types";

const ELEVEN_API = "https://api.elevenlabs.io/v1";

async function tts(
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
      model_id: CONFIG.ELEVENLABS_MODEL,
      voice_settings: {
        stability: CONFIG.ELEVENLABS_STABILITY,
        similarity_boost: CONFIG.ELEVENLABS_SIMILARITY_BOOST,
        speed,
      },
      language_code: language,
    }),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uploadStorage(s: any, buffer: Buffer, storagePath: string): Promise<string> {
  const { error } = await s.storage
    .from(CONFIG.AUDIO_BUCKET)
    .upload(storagePath, buffer, { contentType: "audio/mpeg", upsert: true });
  if (error) throw new Error(`Storage upload ${storagePath}: ${error.message}`);
  const { data: pub } = s.storage.from(CONFIG.AUDIO_BUCKET).getPublicUrl(storagePath);
  return pub.publicUrl;
}

function getStorageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  return createClient(url, key);
}

/** Génère tous les audios pour un jeu dans la langue client. */
export async function runAudio(
  gameId: string,
  game: StructuredGame,
  content: TranslationResult,
): Promise<AudioResult> {
  const s = getStorageClient();
  const speed = CONFIG.ELEVENLABS_SPEED;
  const files: AudioResult["files"] = [];

  // Game-wide
  const gameWide: Array<{ slot: "intro_speech" | "epilogue" | "final_riddle" | "final_explanation"; text: string }> = [
    { slot: "intro_speech", text: content.meta.intro },
    { slot: "epilogue", text: content.meta.epilogue },
    { slot: "final_riddle", text: content.meta.finalRiddleText },
    { slot: "final_explanation", text: content.meta.finalAnswerExplanation },
  ];
  for (const { slot, text } of gameWide) {
    if (!text) continue;
    const buf = await tts(text, CONFIG.ELEVENLABS_DEFAULT_VOICE, content.language, speed);
    const path = `${gameId}/${content.language}/${slot}.mp3`;
    const url = await uploadStorage(s, buf, path);
    files.push({
      stepOrder: 0,
      slot: slot as AudioResult["files"][0]["slot"],
      storagePath: path,
      publicUrl: url,
      duration: 0,
    });
  }

  // Per stop : riddle, character, anecdote
  for (const stop of game.stops) {
    const tStop = content.stops.find((t) => t.step_order === stop.step_order);
    if (!tStop) continue;
    const charVoice =
      CONFIG.ELEVENLABS_ARCHETYPE_VOICES[
        stop.arCharacterType as keyof typeof CONFIG.ELEVENLABS_ARCHETYPE_VOICES
      ] ?? CONFIG.ELEVENLABS_DEFAULT_VOICE;

    for (const { slot, text, voice } of [
      { slot: "riddle" as const, text: tStop.riddle, voice: CONFIG.ELEVENLABS_DEFAULT_VOICE },
      { slot: "character" as const, text: tStop.arCharacterDialogue, voice: charVoice },
      { slot: "anecdote" as const, text: tStop.anecdote, voice: CONFIG.ELEVENLABS_DEFAULT_VOICE },
    ]) {
      if (!text) continue;
      const buf = await tts(text, voice, content.language, speed);
      const path = `${gameId}/${content.language}/step${stop.step_order}_${slot}.mp3`;
      const url = await uploadStorage(s, buf, path);
      files.push({
        stepOrder: stop.step_order,
        slot,
        storagePath: path,
        publicUrl: url,
        duration: 0,
      });
    }
  }

  return { language: content.language, files };
}
