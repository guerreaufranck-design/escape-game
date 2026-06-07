/**
 * OpenAI fallback (2026-06-07) — used when Gemini is unavailable (503 / rate
 * limit / quota). Mirrors the raw-fetch pattern of the existing Claude
 * fallback in gemini.ts (no SDK dependency, so nothing to add to package.json).
 *
 * Env:
 *   - OPENAI_API_KEY  (required)  — set in Vercel
 *   - OPENAI_MODEL    (optional)  — defaults to "gpt-4o-mini"
 *
 * Usage: wrap a Gemini call in try/catch and call this in the catch.
 */
export async function callOpenAI(
  prompt: string,
  jsonMode: boolean,
  temperature = 0.2,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing (OpenAI fallback)");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content ?? "";
  return String(out).trim();
}
