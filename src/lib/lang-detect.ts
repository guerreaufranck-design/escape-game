/**
 * Tiny heuristic language detector for short game-content strings.
 *
 * The Gemini translation prompt assumes its input is English, but we have
 * legacy games where the title or description was stored as plain French
 * (no JSONB wrapping). When we feed that French text to a "translate from
 * English to ja" prompt, Gemini sometimes returns the French unchanged —
 * which then gets cached and served to Japanese players forever.
 *
 * This detector lets the translation pipeline know "this is actually
 * French" so the prompt can be adjusted (or the cache bypassed). The
 * heuristic is intentionally minimal: it only distinguishes the languages
 * we have content stored in (en, fr) plus a few common others.
 *
 * NOT a general-purpose detector. The signal is "does this look French?"
 * — return "en" when unsure.
 */

const FRENCH_MARKERS = [
  // Diacritics and characters that overwhelmingly point to French (or one
  // of its romance neighbours, but those are unlikely sources for our
  // game-content fields).
  "é", "è", "ê", "ë", "à", "â", "ç", "ï", "î", "ô", "û", "ù", "ü", "œ", "æ",
];

const FRENCH_FUNCTION_WORDS = [
  // Short function words that English doesn't share. Boundary checks are
  // done word-by-word so "the" inside "weather" doesn't match.
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "ou", "où",
  "que", "qui", "pour", "dans", "avec", "sur", "vers", "vous", "nous",
  "ils", "elles", "votre", "notre", "leur", "ces", "cette", "cet",
  "est", "sont", "était", "été", "avait", "avoir", "être", "très",
  "mais", "donc", "alors", "aussi", "même", "tout", "tous", "rien",
  "plus", "moins", "bien", "déjà", "encore", "toujours", "jamais",
  "depuis", "pendant", "avant", "après", "comme", "quand", "voici",
  "voilà", "selon", "sans", "sous", "entre", "chez", "vers",
];

const ENGLISH_MARKERS = [
  // Words that English uses that French doesn't share (or uses
  // differently). Used to break ties when both lists score low.
  "the", "and", "of", "to", "in", "for", "with", "by", "is", "was",
  "are", "were", "have", "has", "had", "you", "your", "they", "their",
  "this", "that", "these", "those", "from", "about", "after", "before",
  "between", "during", "should", "would", "could",
];

/**
 * Returns "fr" if the input looks French, "en" otherwise. Tuned for short
 * (under ~500 chars) game-content strings.
 */
export function detectSourceLanguage(text: string): string {
  if (!text || text.length < 4) return "en";

  const lowered = text.toLowerCase();

  // Strong signal: French-specific diacritics. A single one is enough on a
  // field that's supposed to be English — English doesn't naturally use é
  // or ç in original content.
  for (const marker of FRENCH_MARKERS) {
    if (lowered.includes(marker)) return "fr";
  }

  // Word-boundary scan. Tokenise on anything that isn't a letter, then
  // count how many tokens hit each list.
  const tokens = lowered.split(/[^a-zà-ÿœæ]+/).filter(Boolean);
  if (tokens.length === 0) return "en";

  let frScore = 0;
  let enScore = 0;
  const frSet = new Set(FRENCH_FUNCTION_WORDS);
  const enSet = new Set(ENGLISH_MARKERS);
  for (const tok of tokens) {
    if (frSet.has(tok)) frScore++;
    if (enSet.has(tok)) enScore++;
  }

  if (frScore > enScore && frScore >= 2) return "fr";
  return "en";
}
