import { createAdminClient } from "@/lib/supabase/admin";
import { translateText, getGeminiModel } from "@/lib/gemini";
import { getLanguageName } from "@/lib/i18n";

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

  // Check cache first
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

  // Translate with Gemini
  const translated = await translateText(englishText, targetLang);

  // Store in cache (upsert to handle race conditions)
  await supabase
    .from("translations_cache")
    .upsert(
      {
        source_id: sourceId,
        source_table: sourceTable,
        source_field: sourceField,
        language: targetLang,
        translated_text: translated,
      },
      { onConflict: "source_id,source_field,language" }
    );

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

  // Batch translate via JSON approach
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

    for (const [field, text] of Object.entries(parsed)) {
      if (text && toTranslate[field]) {
        result[field] = text;

        supabase
          .from("translations_cache")
          .upsert(
            {
              source_id: stepId,
              source_table: "game_steps",
              source_field: field,
              language: targetLang,
              translated_text: text,
            },
            { onConflict: "source_id,source_field,language" }
          )
          .then(() => {});
      }
    }
  } catch (err) {
    console.error("Step translation error:", err);
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
