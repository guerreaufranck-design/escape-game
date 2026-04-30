/**
 * Robust pre-warm of ui_translations_cache for ALL dynamic locales.
 *
 * Bypasses the flaky /api/translations endpoint (which has fire-and-forget
 * upserts and a single oversized Gemini call that truncates output).
 *
 * Instead:
 *   1. For each locale, list keys not yet cached
 *   2. Chunk into batches of ~30 keys (small enough that Gemini's 8K
 *      output token limit never truncates, even for verbose languages)
 *   3. Call Gemini per chunk with retries on 503 / timeout / parse errors
 *   4. Direct synchronous upsert into ui_translations_cache
 *   5. Report final coverage per locale
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import { ui } from "../src/lib/translations";
import { getLanguageName } from "../src/lib/i18n";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// All 27 dynamic locales (everything except fr/en/de/es/it which are static)
const ALL_DYNAMIC = [
  "pt", "nl", "pl", "ru", "zh", "ja", "ko", "ar", "hi", "tr",
  "sv", "da", "no", "fi", "el", "cs", "ro", "hu", "th", "he",
  "uk", "id", "vi", "ms", "hr", "bg", "ca",
];

const CHUNK_SIZE = 30;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 2000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildPrompt(chunk: Record<string, string>, langName: string): string {
  return `You are translating the UI of a tourist escape-game mobile app to ${langName}.

You will receive a JSON object where each value is an English UI string.
Return a JSON object with the SAME keys, where each value is the ${langName}
translation of the corresponding English string.

CRITICAL RULES:
1. Output VALID JSON only. No markdown, no commentary.
2. Preserve placeholders EXACTLY: {duration}, {n}, {total}, {penalty},
   {arButton}, {distance}. Do NOT translate or remove them.
3. Preserve newlines (\\n) inside string values.
4. Keep button labels SHORT (1-3 words) — they go in tight UI space.
5. Use natural, idiomatic ${langName}.
6. Brand names ("OddballTrip", "DIVAN", "AR", "GPS", "112") stay in English.

Source pack:
${JSON.stringify(chunk)}`;
}

function parseTranslationResponse(
  raw: string,
  chunk: Record<string, string>,
): Record<string, string> | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const k of Object.keys(chunk)) {
      const v = parsed[k];
      if (typeof v === "string" && v.trim()) out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

async function translateWithGemini(
  chunk: Record<string, string>,
  langName: string,
): Promise<Record<string, string> | null> {
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: buildPrompt(chunk, langName) }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });
  return parseTranslationResponse(result.response.text(), chunk);
}

async function translateWithClaude(
  chunk: Record<string, string>,
  langName: string,
): Promise<Record<string, string> | null> {
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    temperature: 0.2,
    messages: [{ role: "user", content: buildPrompt(chunk, langName) }],
  });
  const text = msg.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("");
  return parseTranslationResponse(text, chunk);
}

async function translateChunk(
  chunk: Record<string, string>,
  targetLang: string,
  langName: string,
): Promise<Record<string, string> | null> {
  // Try Gemini first (faster + cheaper).
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const out = await translateWithGemini(chunk, langName);
      if (out) {
        const missing = Object.keys(chunk).filter((k) => !(k in out));
        if (missing.length === 0) return out;
        if (attempt < MAX_RETRIES) {
          console.log(`    gemini attempt ${attempt}: ${missing.length} missing, retrying`);
          await sleep(RETRY_BACKOFF_MS * attempt);
          continue;
        }
        return out; // partial result better than nothing
      }
      if (attempt < MAX_RETRIES) await sleep(RETRY_BACKOFF_MS * attempt);
    } catch (err) {
      const msg = (err as Error).message || String(err);
      console.log(`    gemini attempt ${attempt} failed: ${msg.slice(0, 80)}`);
      if (attempt < MAX_RETRIES) await sleep(RETRY_BACKOFF_MS * attempt);
    }
  }

  // Gemini exhausted — fall back to Claude. Claude has been more stable
  // when Gemini hits transient overload windows.
  console.log(`    falling back to Claude...`);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const out = await translateWithClaude(chunk, langName);
      if (out && Object.keys(out).length > 0) {
        console.log(`    ✓ claude returned ${Object.keys(out).length}/${Object.keys(chunk).length} keys`);
        return out;
      }
    } catch (err) {
      const msg = (err as Error).message || String(err);
      console.log(`    claude attempt ${attempt} failed: ${msg.slice(0, 80)}`);
      if (attempt < 2) await sleep(RETRY_BACKOFF_MS * attempt);
    }
  }
  return null;
}

async function processLocale(locale: string) {
  const langName = getLanguageName(locale);
  console.log(`\n━━━ ${locale} (${langName}) ━━━`);

  // What's already cached
  const { data: cached } = await supabase
    .from("ui_translations_cache")
    .select("translation_key")
    .eq("language", locale);
  const cachedSet = new Set((cached || []).map((r) => r.translation_key));

  // What's missing
  const englishPack: Record<string, string> = {};
  for (const [key, entry] of Object.entries(ui)) {
    if (!cachedSet.has(key)) {
      englishPack[key] = entry.en || entry.fr || key;
    }
  }
  const missingCount = Object.keys(englishPack).length;
  const totalKeys = Object.keys(ui).length;

  if (missingCount === 0) {
    console.log(`  ✅ already complete (${totalKeys}/${totalKeys})`);
    return { locale, before: totalKeys, after: totalKeys, gained: 0 };
  }

  console.log(`  ${cachedSet.size}/${totalKeys} cached, translating ${missingCount} missing keys`);

  // Chunk
  const allKeys = Object.keys(englishPack);
  const chunks: Record<string, string>[] = [];
  for (let i = 0; i < allKeys.length; i += CHUNK_SIZE) {
    const chunk: Record<string, string> = {};
    for (const k of allKeys.slice(i, i + CHUNK_SIZE)) chunk[k] = englishPack[k];
    chunks.push(chunk);
  }
  console.log(`  ${chunks.length} chunks of ≤${CHUNK_SIZE} keys`);

  let inserted = 0;
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const t0 = Date.now();
    const translated = await translateChunk(chunk, locale, langName);
    if (!translated) {
      console.log(`  ✗ chunk ${idx + 1}/${chunks.length} failed permanently (${Object.keys(chunk).length} keys lost)`);
      continue;
    }
    const rows = Object.entries(translated).map(([translation_key, translated_text]) => ({
      translation_key,
      language: locale,
      translated_text,
    }));
    if (rows.length === 0) continue;
    const { error } = await supabase
      .from("ui_translations_cache")
      .upsert(rows, { onConflict: "translation_key,language" });
    if (error) {
      console.log(`  ✗ upsert error chunk ${idx + 1}: ${error.message}`);
      continue;
    }
    inserted += rows.length;
    console.log(
      `  ✓ chunk ${idx + 1}/${chunks.length}: ${rows.length} keys in ${Date.now() - t0}ms`,
    );
    // Tiny pacing between chunks to be polite to Gemini
    if (idx < chunks.length - 1) await sleep(500);
  }

  // Final count
  const { count } = await supabase
    .from("ui_translations_cache")
    .select("*", { count: "exact", head: true })
    .eq("language", locale);

  return {
    locale,
    before: cachedSet.size,
    after: count || 0,
    gained: inserted,
  };
}

async function main() {
  const targets = ALL_DYNAMIC;
  console.log(`Pre-warming ${targets.length} dynamic locales (${Object.keys(ui).length} keys each)\n`);

  const results: Array<{ locale: string; before: number; after: number; gained: number }> = [];
  const t0 = Date.now();
  for (const locale of targets) {
    const r = await processLocale(locale);
    results.push(r);
  }
  const elapsedMin = ((Date.now() - t0) / 60000).toFixed(1);

  console.log(`\n\n═══ FINAL REPORT (${elapsedMin} min) ═══\n`);
  const totalKeys = Object.keys(ui).length;
  const fully = results.filter((r) => r.after >= totalKeys).length;
  const partial = results.filter((r) => r.after > 0 && r.after < totalKeys).length;
  const empty = results.filter((r) => r.after === 0).length;

  for (const r of results) {
    const ratio = `${r.after}/${totalKeys}`;
    const flag = r.after >= totalKeys ? "✅" : r.after >= totalKeys * 0.95 ? "🟢" : r.after > 0 ? "🟡" : "❌";
    const delta = r.gained > 0 ? ` (+${r.gained})` : "";
    console.log(`${flag} ${r.locale.padEnd(4)} ${ratio.padEnd(8)}${delta}`);
  }
  console.log(`\nFull coverage: ${fully}/${results.length}`);
  console.log(`Partial:       ${partial}/${results.length}`);
  console.log(`Empty:         ${empty}/${results.length}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
