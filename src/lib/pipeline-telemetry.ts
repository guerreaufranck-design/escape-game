/**
 * Pipeline telemetry — capture cost per generation per game.
 *
 * Usage :
 *   await logTelemetry({
 *     gameId,
 *     phase: "narration",
 *     provider: "claude",
 *     inputTokens: 12_500,
 *     outputTokens: 4_200,
 *     durationMs: 18_400,
 *   });
 *
 * Le cost_usd est calculé automatiquement via PRICE_TABLE. Si le provider
 * n'est pas dans la table, on stocke null pour cost_usd (visible à l'audit).
 *
 * Toutes les fonctions sont fire-and-forget : si la DB est down ou l'insert
 * échoue, on log un warning et on N'INTERROMPT PAS la pipeline. Le coût est
 * une métadonnée utile, pas un blocker fonctionnel.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export type TelemetryPhase =
  | "discovery"
  | "narration"
  | "final_riddle"
  | "translation"
  | "audio"
  | "geocoding"
  | "other";

export type TelemetryProvider =
  | "gemini"
  | "claude"
  | "elevenlabs"
  | "google_places"
  | "perplexity"
  | "other";

interface TelemetryParams {
  gameId: string | null;
  phase: TelemetryPhase;
  provider: TelemetryProvider;
  language?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Audio seconds generated (ElevenLabs). */
  audioSeconds?: number;
  /** Combined call count if this row aggregates several calls (e.g. all
   *  translations for a step batched together). Default 1. */
  apiCalls?: number;
  /** Wall-clock duration in ms (helpful to detect provider slowdowns). */
  durationMs?: number;
  /** Arbitrary extra fields (e.g. model name, batch size). */
  metadata?: Record<string, unknown>;
  /** Override cost_usd if the caller already knows it (e.g. ElevenLabs
   *  bills per second so we compute outside). */
  costUsd?: number;
}

/**
 * Pricing as of 2026-05-17. Values in USD per million tokens (or per
 * minute for audio). Update when providers change rates — single source
 * of truth, applied retroactively to all rows from now on.
 *
 * Conservative estimates (we under-estimate rather than over-claim
 * savings — better surprises than disappointments).
 */
const PRICE_TABLE = {
  claude: {
    // Claude Sonnet 4 official rates (2025) :
    // $3 / 1M input, $15 / 1M output
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
  gemini: {
    // Gemini 2.5 Pro rates (2025) :
    // $1.25 / 1M input, $5 / 1M output
    inputPerMillion: 1.25,
    outputPerMillion: 5,
  },
  perplexity: {
    // Perplexity sonar-pro : $3 / 1M input, $15 / 1M output (+ search fees)
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
  elevenlabs: {
    // Flash v2.5 : ~$0.18 per 1000 characters → roughly $0.03 / minute
    // of speech. We charge per audioSeconds.
    perAudioSecond: 0.0005, // $0.0005/s = $0.03/min
  },
  google_places: {
    // Places API "Find Place" / "Place Details" : $17 per 1000 reqs.
    perApiCall: 0.017,
  },
} as const;

function computeCost(p: TelemetryParams): number | null {
  if (typeof p.costUsd === "number") return p.costUsd;
  switch (p.provider) {
    case "claude": {
      const rate = PRICE_TABLE.claude;
      const inCost = ((p.inputTokens ?? 0) / 1_000_000) * rate.inputPerMillion;
      const outCost =
        ((p.outputTokens ?? 0) / 1_000_000) * rate.outputPerMillion;
      return Number((inCost + outCost).toFixed(4));
    }
    case "gemini": {
      const rate = PRICE_TABLE.gemini;
      const inCost = ((p.inputTokens ?? 0) / 1_000_000) * rate.inputPerMillion;
      const outCost =
        ((p.outputTokens ?? 0) / 1_000_000) * rate.outputPerMillion;
      return Number((inCost + outCost).toFixed(4));
    }
    case "perplexity": {
      const rate = PRICE_TABLE.perplexity;
      const inCost = ((p.inputTokens ?? 0) / 1_000_000) * rate.inputPerMillion;
      const outCost =
        ((p.outputTokens ?? 0) / 1_000_000) * rate.outputPerMillion;
      return Number((inCost + outCost).toFixed(4));
    }
    case "elevenlabs": {
      const rate = PRICE_TABLE.elevenlabs;
      return Number(((p.audioSeconds ?? 0) * rate.perAudioSecond).toFixed(4));
    }
    case "google_places": {
      const rate = PRICE_TABLE.google_places;
      return Number(((p.apiCalls ?? 1) * rate.perApiCall).toFixed(4));
    }
    default:
      return null;
  }
}

export async function logTelemetry(params: TelemetryParams): Promise<void> {
  try {
    if (!params.gameId) return; // pre-insert phase, no game_id yet
    const supabase = createAdminClient();
    const costUsd = computeCost(params);
    const { error } = await supabase.from("pipeline_telemetry").insert({
      game_id: params.gameId,
      phase: params.phase,
      provider: params.provider,
      language: params.language ?? null,
      input_tokens: params.inputTokens ?? null,
      output_tokens: params.outputTokens ?? null,
      audio_seconds: params.audioSeconds ?? null,
      api_calls: params.apiCalls ?? 1,
      cost_usd: costUsd,
      duration_ms: params.durationMs ?? null,
      metadata: params.metadata ?? null,
    });
    if (error) {
      console.warn(
        `[telemetry] insert failed for game ${params.gameId} (${params.provider}/${params.phase}): ${error.message}`,
      );
    }
  } catch (err) {
    console.warn(
      `[telemetry] threw : ${err instanceof Error ? err.message : err}`,
    );
  }
}

/**
 * Log AT THE END of a generation pipeline the ESTIMATED cost breakdown
 * for the providers that aren't instrumented inline (Anthropic, Gemini
 * discovery, Google Places). Estimates are based on game shape (stop
 * count, language, transport mode) and the typical call profile.
 *
 * Better-than-nothing visibility : sans ce log, l'utilisateur ne voit
 * QUE le coût ElevenLabs (~$0.55) alors qu'il dépense en réalité
 * ~$1.43 par jeu. Ce log capture les ~$0.88 manquants.
 *
 * Ces rows sont marquées `metadata.is_estimate = true` pour les
 * distinguer des mesures réelles (audio = vraie mesure depuis byte_size).
 */
export async function logEstimatedGenerationCost(params: {
  gameId: string;
  stopCount: number;
  language?: string;
}): Promise<void> {
  const { gameId, stopCount, language } = params;

  // Anthropic Claude — pre-insert narrations + final riddle + epilogue + intro.
  // generateGameSteps : 1 call avec ALL stops dans le prompt (~30k input + 8k output).
  // generateFinalRiddle : 1 call (~2k in, 500 out).
  // generateEpilogue : 1 call (~5k in, 2k out).
  // generateIntroSpeech : 1 call (~2k in, 500 out).
  // Total moyen par jeu : ~40k input + 11k output.
  // Coût : 40k × $3/1M + 11k × $15/1M = $0.12 + $0.165 = ~$0.29.
  await logTelemetry({
    gameId,
    phase: "narration",
    provider: "claude",
    language,
    inputTokens: 30_000 + stopCount * 1_500, // 30k base + 1.5k par stop
    outputTokens: 6_000 + stopCount * 1_000,
    apiCalls: 4, // generateGameSteps + finalRiddle + epilogue + introSpeech
    metadata: { is_estimate: true, model: "claude-sonnet-4" },
  });

  // Gemini discovery — grounded research + Pass 2 patrimoine-fill.
  // Pass 1 : ~5k input + 3k output. Pass 2 (si trigger) : ~3k + 2k.
  // Coût : ~$0.05 par jeu en moyenne.
  await logTelemetry({
    gameId,
    phase: "discovery",
    provider: "gemini",
    language,
    inputTokens: 8_000,
    outputTokens: 5_000,
    apiCalls: 2,
    metadata: { is_estimate: true, model: "gemini-2.5-pro" },
  });

  // Google Places — geocoding + photos + B3 cross-validation + city centre.
  // Par jeu : 1 city centre + N geocodes + N photos × 2 (Details + Photo) + N B3 cross-validation.
  // Soit ~1 + N + 2N + N = 4N + 1 calls. Pour N=8 : ~33 calls × $0.024 = ~$0.79.
  // Bonus discoverNearbyLandmarks : ~10 calls × $0.04 = $0.40 mais SEULEMENT
  // pour les jeux qui font fallback Google Places nearbysearch (rare avec
  // Gemini patrimoine-first). On garde l'estimation conservative.
  const googleCalls = 4 * stopCount + 1;
  await logTelemetry({
    gameId,
    phase: "geocoding",
    provider: "google_places",
    language,
    apiCalls: googleCalls,
    metadata: { is_estimate: true, breakdown: "1 center + N geocode + 2N photos + N B3" },
  });
}

/**
 * Aggregates total cost for a game across all telemetry rows. Used by
 * the admin dashboard to spot expensive games.
 */
export async function getGameCost(
  gameId: string,
): Promise<{
  totalUsd: number;
  byProvider: Record<string, number>;
  byPhase: Record<string, number>;
  rowCount: number;
}> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("pipeline_telemetry")
    .select("provider, phase, cost_usd")
    .eq("game_id", gameId);

  const result = {
    totalUsd: 0,
    byProvider: {} as Record<string, number>,
    byPhase: {} as Record<string, number>,
    rowCount: data?.length ?? 0,
  };
  for (const row of data ?? []) {
    const c = Number(row.cost_usd ?? 0);
    result.totalUsd += c;
    result.byProvider[row.provider] = (result.byProvider[row.provider] ?? 0) + c;
    result.byPhase[row.phase] = (result.byPhase[row.phase] ?? 0) + c;
  }
  result.totalUsd = Number(result.totalUsd.toFixed(4));
  return result;
}
