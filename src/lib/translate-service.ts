import { createAdminClient } from "@/lib/supabase/admin";
import { translateText, getGeminiModel } from "@/lib/gemini";
import { getLanguageName } from "@/lib/i18n";

// Hard upper bound per single Gemini call. Short fields (riddle, hint)
// finish in < 4s; long-form fields (epilogue: 4-6 paragraphs) routinely
// take 8-12s in Japanese/Chinese where every char matters. 30s gives
// plenty of headroom for the epilogue without locking the player out
// indefinitely on a Gemini hiccup.
const TRANSLATION_TIMEOUT_MS = 30000;
// Number of retry attempts before giving up. The first attempt + 1 retry
// catches most transient blips without paying double cost on every call.
const TRANSLATION_RETRY_ATTEMPTS = 2;

/**
 * Wrap a promise with a timeout. Throws "translation timeout" on expiry.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

/**
 * Run a translation operation with bounded retries + timeout. Each attempt
 * is independently bounded; total worst case is attempts × timeout.
 */
async function translateWithRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= TRANSLATION_RETRY_ATTEMPTS; attempt++) {
    try {
      return await withTimeout(fn(), TRANSLATION_TIMEOUT_MS, label);
    } catch (err) {
      lastErr = err;
      // Tiny backoff on retry — 200ms is enough to dodge transient
      // 429/5xx Gemini blips without slowing things down meaningfully.
      if (attempt < TRANSLATION_RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Translate game content (riddle, hint, anecdote, etc.) with Supabase cache.
 * If content is already in the target language (English base), returns as-is.
 */
export async function translateGameField(
  sourceId: string,
  sourceTable: string,
  sourceField: string,
  englishText: string,
  targetLang: string
): Promise<string> {
  // English is the base language — no translation needed
  if (targetLang === "en" || !englishText.trim()) {
    return englishText;
  }

  const supabase = createAdminClient();

  // Check cache first — this is the fast path, no Gemini call.
  const { data: cached } = await supabase
    .from("translations_cache")
    .select("translated_text")
    .eq("source_id", sourceId)
    .eq("source_field", sourceField)
    .eq("language", targetLang)
    .single();

  if (cached?.translated_text) {
    return cached.translated_text;
  }

  // Cache miss — call Gemini with bounded timeout + 1 retry, then cache.
  const translated = await translateWithRetry(
    () => translateText(englishText, targetLang),
    `translateGameField:${sourceField}`,
  );

  // Don't cache EN-as-translation — see translateStepFields for the
  // same protection. Caching identical text would lock the player into
  // English on every subsequent visit.
  const isUnchanged =
    translated.trim().toLowerCase() === englishText.trim().toLowerCase();
  if (isUnchanged) {
    return translated; // serve once, never cache
  }

  // Cache write is fire-and-forget (next reader will hit the cache).
  void supabase
    .from("translations_cache")
    .upsert(
      {
        source_id: sourceId,
        source_table: sourceTable,
        source_field: sourceField,
        language: targetLang,
        translated_text: translated,
      },
      { onConflict: "source_id,source_field,language" },
    )
    .then(() => {});

  return translated;
}

/**
 * Translate multiple fields at once for a game step.
 * More efficient: one Gemini call for all fields combined.
 */
export async function translateStepFields(
  stepId: string,
  fields: Record<string, string>, // { riddle_text: "...", title: "...", ... }
  targetLang: string
): Promise<Record<string, string>> {
  if (targetLang === "en") return fields;

  const supabase = createAdminClient();
  const result: Record<string, string> = {};
  const toTranslate: Record<string, string> = {};

  // Check cache for all fields
  const fieldNames = Object.keys(fields);
  const { data: cached } = await supabase
    .from("translations_cache")
    .select("source_field, translated_text")
    .eq("source_id", stepId)
    .eq("language", targetLang)
    .in("source_field", fieldNames);

  const cachedMap = new Map(
    (cached || []).map((c) => [c.source_field, c.translated_text])
  );

  for (const [field, text] of Object.entries(fields)) {
    if (cachedMap.has(field)) {
      result[field] = cachedMap.get(field)!;
    } else if (text.trim()) {
      toTranslate[field] = text;
    } else {
      result[field] = text;
    }
  }

  // If nothing to translate, return cached results
  if (Object.keys(toTranslate).length === 0) return result;

  // Batch translate via JSON approach. ONE Gemini call covers every
  // un-cached field of the step in a single round-trip. If the batch
  // call fails (rate limit, JSON parse, timeout, safety filter), we
  // fall back to individual per-field translations — slower but
  // dramatically more reliable. The previous "all-or-nothing" caused
  // entire steps to be served in EN when one tricky field broke the
  // batch parse, which is exactly the bug the user just reported.
  const langName = getLanguageName(targetLang);

  let batchSucceeded = false;
  try {
    const parsed = await translateWithRetry(async () => {
      const model = getGeminiModel();
      const geminiResult = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `You are a professional translator. Translate ALL values in the following JSON object from English to ${langName}. Keep the keys exactly as they are. Return ONLY a valid JSON object, nothing else.\n\n${JSON.stringify(toTranslate, null, 2)}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      });
      const translatedText = geminiResult.response.text().trim();
      return JSON.parse(translatedText) as Record<string, string>;
    }, `translateStepFields:${stepId}`);

    let cachedCount = 0;
    for (const [field, text] of Object.entries(parsed)) {
      if (text && toTranslate[field]) {
        // Detect "Gemini didn't translate" — output equals input verbatim.
        // Happens when the source contains a lot of foreign words (Latin
        // riddles, place names) and Gemini gives up and echoes back. We
        // do NOT cache that as a translation — caching the EN as the
        // FR cache hit would lock the player into EN forever. Better to
        // fall through to per-field with a fresh attempt.
        const isUnchanged =
          text.trim().toLowerCase() === toTranslate[field].trim().toLowerCase();
        if (isUnchanged) {
          continue; // leave field absent → batchSucceeded stays false → per-field fallback runs
        }
        result[field] = text;
        cachedCount++;

        void supabase
          .from("translations_cache")
          .upsert(
            {
              source_id: stepId,
              source_table: "game_steps",
              source_field: field,
              language: targetLang,
              translated_text: text,
            },
            { onConflict: "source_id,source_field,language" },
          )
          .then(() => {});
      }
    }
    if (cachedCount === Object.keys(toTranslate).length) {
      batchSucceeded = true;
    }
  } catch (err) {
    console.warn(
      `[translate-service] step ${stepId} batch translate failed after retries, falling back to per-field. err=${err instanceof Error ? err.message : err}`,
    );
  }

  // Per-field fallback for any field the batch call missed.
  if (!batchSucceeded) {
    const missingFields = Object.entries(toTranslate).filter(
      ([f]) => !result[f],
    );
    if (missingFields.length > 0) {
      console.log(
        `[translate-service] step ${stepId} per-field fallback on ${missingFields.length} field(s)`,
      );
      const perFieldResults = await Promise.allSettled(
        missingFields.map(async ([field, en]) => {
          const t = await translateWithRetry(
            () => translateText(en, targetLang),
            `translateStepFields:fallback:${stepId}:${field}`,
          );
          return { field, text: t };
        }),
      );
      for (const r of perFieldResults) {
        if (r.status === "fulfilled" && r.value.text) {
          // Same "didn't translate" detection as in the batch path.
          const sourceEn = toTranslate[r.value.field];
          const isUnchanged =
            r.value.text.trim().toLowerCase() ===
            (sourceEn || "").trim().toLowerCase();
          if (isUnchanged) continue;

          result[r.value.field] = r.value.text;
          void supabase
            .from("translations_cache")
            .upsert(
              {
                source_id: stepId,
                source_table: "game_steps",
                source_field: r.value.field,
                language: targetLang,
                translated_text: r.value.text,
              },
              { onConflict: "source_id,source_field,language" },
            )
            .then(() => {});
        }
      }
    }
  }

  // Fallback for any missing fields
  for (const [field, text] of Object.entries(toTranslate)) {
    if (!result[field]) {
      result[field] = text;
    }
  }

  return result;
}

/**
 * Translate UI strings for non-static locales.
 * Translates all UI keys at once and caches them.
 */
export async function translateUIStrings(
  uiStrings: Record<string, string>, // key → English text
  targetLang: string
): Promise<Record<string, string>> {
  if (targetLang === "en") return uiStrings;

  const supabase = createAdminClient();
  const result: Record<string, string> = {};
  const toTranslate: Record<string, string> = {};

  // Check cache for all keys
  const keys = Object.keys(uiStrings);
  const { data: cached } = await supabase
    .from("ui_translations_cache")
    .select("translation_key, translated_text")
    .eq("language", targetLang)
    .in("translation_key", keys);

  const cachedMap = new Map(
    (cached || []).map((c) => [c.translation_key, c.translated_text])
  );

  for (const [key, text] of Object.entries(uiStrings)) {
    if (cachedMap.has(key)) {
      result[key] = cachedMap.get(key)!;
    } else {
      toTranslate[key] = text;
    }
  }

  if (Object.keys(toTranslate).length === 0) return result;

  // Build a JSON object for Gemini to translate
  const langName = getLanguageName(targetLang);

  try {
    const model = getGeminiModel();
    const geminiResult = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are a professional translator. Translate ALL values in the following JSON object from English to ${langName}. Keep the keys exactly as they are. Return ONLY a valid JSON object, nothing else.\n\n${JSON.stringify(toTranslate, null, 2)}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });

    const translatedText = geminiResult.response.text().trim();
    const parsed = JSON.parse(translatedText) as Record<string, string>;

    for (const [key, text] of Object.entries(parsed)) {
      if (text && toTranslate[key]) {
        result[key] = text;

        // Cache each translated string
        supabase
          .from("ui_translations_cache")
          .upsert(
            {
              translation_key: key,
              language: targetLang,
              translated_text: text,
            },
            { onConflict: "translation_key,language" }
          )
          .then(() => {});
      }
    }

    // Fallback for any missing keys
    for (const [key, text] of Object.entries(toTranslate)) {
      if (!result[key]) {
        result[key] = text;
      }
    }
  } catch (err) {
    console.error("UI translation error:", err);
    // On error, return English
    for (const [key, text] of Object.entries(toTranslate)) {
      result[key] = text;
    }
  }

  return result;
}
