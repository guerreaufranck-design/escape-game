/**
 * ElevenLabs TTS integration.
 *
 * Single entry point: generateAndStoreAudio(...) takes a text, a voice,
 * a language and a target storage path; returns the public URL of the
 * uploaded MP3. Used by the game-package orchestrator at purchase time.
 *
 * Model: eleven_multilingual_v2 — premium quality, supports 32 langs
 *        with the same voice character. ~250ms latency, $0.10 / 1k chars.
 */

import { createAdminClient } from "@/lib/supabase/admin";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";
const MODEL_ID = "eleven_multilingual_v2";
const STORAGE_BUCKET = "audio";

/**
 * Default fallback voice. The user has favorited "Dallin - Storyteller"
 * in the voice library: a calm, middle-aged male American narrator —
 * good fit for the OddballTrip narrative tone.
 *
 * Used until the user picks dedicated voices for each archetype in
 * voice-map.ts (e.g. a deeper voice for knight, raspier for witch, etc.).
 *
 * Available alternatives in the user's library (from list-my-voices.ts):
 *   - Donovan (deep male):       DMyrgzQFny3JI1Y1paM5
 *   - George Daigle (deep male): 1GCQiLWWVadqyDYY3CK9
 *   - Luna (fr, meditative):     iB0Pwf5VYt7UDBrGrMqH
 *   - Cherie (female narrative): vr5WKaGvRWsoaX5LCVax
 */
export const DEFAULT_VOICE_ID = "alFofuDn3cOwyoz1i44T"; // Dallin Storyteller

interface GenerateOptions {
  text: string;
  voiceId: string;
  /** target storage path inside the 'audio' bucket, e.g. "<gameId>/ja/step1_character.mp3" */
  storagePath: string;
  /**
   * Voice settings. Defaults tuned for narrative immersion in an
   * outdoor escape game: slow, intimate, grounded, never rushed.
   * Players are walking; they need time to absorb the historical
   * anecdote before the next clue.
   */
  stability?: number;
  similarityBoost?: number;
  /** Playback speed (0.7 - 1.2). Default 0.85 = ~15% slower than natural. */
  speed?: number;
}

export interface GenerateResult {
  publicUrl: string;
  byteSize: number;
}

/**
 * Generate one MP3 with ElevenLabs and upload to Supabase Storage.
 * Throws on any failure — caller is responsible for retry / fallback.
 */
export async function generateAndStoreAudio(
  opts: GenerateOptions,
): Promise<GenerateResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY missing");
  }

  // 1. Hit ElevenLabs TTS endpoint
  const ttsRes = await fetch(
    `${ELEVENLABS_API_BASE}/text-to-speech/${opts.voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: opts.text,
        model_id: MODEL_ID,
        voice_settings: {
          stability: opts.stability ?? 0.6,
          similarity_boost: opts.similarityBoost ?? 0.75,
          // 0.85 = noticeably slower than natural speech. Players walking
          // need time to absorb the line; rushed narration breaks the
          // immersive escape-game atmosphere we want.
          speed: opts.speed ?? 0.85,
        },
      }),
    },
  );

  if (!ttsRes.ok) {
    const errBody = await ttsRes.text();
    throw new Error(
      `ElevenLabs TTS failed (${ttsRes.status}): ${errBody.slice(0, 200)}`,
    );
  }

  const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());

  // 2. Upload to Supabase Storage (overwrites if path exists, idempotent)
  const supabase = createAdminClient();
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(opts.storagePath, audioBuffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
  }

  // 3. Get the public URL
  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(opts.storagePath);

  return {
    publicUrl: urlData.publicUrl,
    byteSize: audioBuffer.length,
  };
}

/**
 * Build the canonical storage path for a game's audio asset.
 * Convention: <gameId>/<language>/step<order>_<slot>.mp3
 *   step 0 = epilogue
 *   step 1-N = step character / anecdote
 */
export function buildAudioPath(
  gameId: string,
  language: string,
  stepOrder: number,
  slot: "character" | "anecdote" | "epilogue" | "riddle",
): string {
  return `${gameId}/${language}/step${stepOrder}_${slot}.mp3`;
}
