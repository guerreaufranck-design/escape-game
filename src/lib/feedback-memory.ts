/**
 * Feedback Memory — RAG-style retrieval of past negative feedback.
 *
 * When a new game is generated, we look up admin thumbs-down feedback from
 * similar contexts (same theme, same city, same answer source) and inject
 * the lessons into the Claude prompt so the new game avoids repeating
 * patterns that didn't work.
 *
 * This is the "self-improvement" loop: every 👎 + comment from the admin
 * review UI enriches the future generations on similar games.
 */

import { createAdminClient } from "./supabase/admin";

interface FeedbackHint {
  theme?: string | null;
  city?: string | null;
  comment?: string | null;
}

/**
 * Fetch up to N relevant negative feedbacks for a given theme/city.
 * Falls back from "exact match" → "same theme" → "any" so the most
 * specific lessons are prioritised.
 */
export async function getRelevantNegativeFeedback(params: {
  theme?: string | null;
  city?: string | null;
  limit?: number;
}): Promise<FeedbackHint[]> {
  const limit = params.limit ?? 8;
  const supabase = createAdminClient();

  // Tier 1 — exact city + theme match
  if (params.city && params.theme) {
    const { data } = await supabase
      .from("step_feedback")
      .select("theme, city, comment")
      .eq("rating", -1)
      .eq("city", params.city)
      .eq("theme", params.theme)
      .not("comment", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (data && data.length > 0) return data as FeedbackHint[];
  }

  // Tier 2 — same theme any city
  if (params.theme) {
    const { data } = await supabase
      .from("step_feedback")
      .select("theme, city, comment")
      .eq("rating", -1)
      .eq("theme", params.theme)
      .not("comment", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (data && data.length > 0) return data as FeedbackHint[];
  }

  // Tier 3 — same city any theme
  if (params.city) {
    const { data } = await supabase
      .from("step_feedback")
      .select("theme, city, comment")
      .eq("rating", -1)
      .eq("city", params.city)
      .not("comment", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (data && data.length > 0) return data as FeedbackHint[];
  }

  // Tier 4 — global recent learnings (last 5)
  const { data } = await supabase
    .from("step_feedback")
    .select("theme, city, comment")
    .eq("rating", -1)
    .not("comment", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);
  return (data || []) as FeedbackHint[];
}

/**
 * Format negative feedback as a "lessons learned" prompt fragment.
 * Returns empty string if no feedback — caller should handle this.
 */
export function formatFeedbackForPrompt(feedback: FeedbackHint[]): string {
  if (feedback.length === 0) return "";

  const bullets = feedback
    .filter((f) => f.comment && f.comment.trim().length > 0)
    .map(
      (f) =>
        `- ${f.comment}${f.city || f.theme ? ` (context: ${[f.theme, f.city].filter(Boolean).join(" / ")})` : ""}`,
    )
    .slice(0, 8)
    .join("\n");

  if (!bullets) return "";

  return `\n\nLESSONS FROM PREVIOUS REVIEWS — avoid these patterns:\n${bullets}\n`;
}
