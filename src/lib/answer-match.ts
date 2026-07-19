/**
 * Validation d'une réponse de stop — SOURCE UNIQUE (serveur + client offline).
 *
 * Le gate d'un stop = le mot tapé (le GPS n'est plus bloquant, cf.
 * validate-step). En extrayant cette logique ici, le mode HORS-LIGNE peut
 * valider une étape côté navigateur, exactement comme le serveur, sans réseau.
 *
 * ⚠️ Comportement identique à l'ancien inline de validate-step :
 *   - normalisation : NFD, sans diacritiques, minuscules, trim, sans espaces
 *   - answer_text peut être une string OU un objet {en, fr, …}
 *   - un stop SANS answer_text (legacy) est accepté sans vérif texte
 */

const DIACRITICS = /[̀-ͯ]/g;

/** Normalise une réponse pour comparaison tolérante (accents/casse/espaces). */
export function normalizeAnswer(s: string): string {
  return s
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "");
}

/** Extrait la réponse attendue depuis answer_text (string ou {en,fr,…}). */
export function extractExpectedAnswer(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "object") {
    const o = raw as Record<string, string>;
    return o.en || o.fr || Object.values(o)[0] || null;
  }
  const s = String(raw);
  return s.trim().length > 0 ? s : null;
}

/**
 * Vrai si la réponse soumise correspond à l'attendue.
 * Un stop sans réponse stockée (legacy) est accepté (comme le serveur).
 */
/** Distance de Levenshtein (nombre minimal d'éditions caractère). */
function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Tolérance aux fautes d'orthographe. Seuil calibré selon la longueur pour
 * accepter une petite faute SANS accepter une vraie mauvaise réponse :
 *   ≤ 3 lettres → exact (MAR ≠ MAS)
 *   4-6         → 1 édition
 *   ≥ 7         → 2 éditions
 * On refuse aussi si l'écart de longueur dépasse la tolérance.
 */
export function fuzzyEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const len = Math.max(a.length, b.length);
  const tol = len <= 3 ? 0 : len <= 6 ? 1 : 2;
  if (tol === 0) return false;
  if (Math.abs(a.length - b.length) > tol) return false;
  return levenshtein(a, b) <= tol;
}

export function matchAnswer(submitted: string, expectedRaw: unknown): boolean {
  const expected = extractExpectedAnswer(expectedRaw);
  if (!expected) return true; // legacy / GPS-only step
  const a = normalizeAnswer(submitted);
  const b = normalizeAnswer(expected);
  return a.length > 0 && fuzzyEqual(a, b);
}

/**
 * PUZZLE MODE — hash SHA-256 d'une réponse normalisée, avec sel.
 * Permet au client (même HORS-LIGNE) de valider une réponse déchiffrée SANS
 * jamais recevoir la solution en clair. Même fonction serveur + navigateur
 * (globalThis.crypto.subtle existe des deux côtés). Renvoie du hex.
 */
const PUZZLE_SALT = "oddballtrip-puzzle-v1";
export async function answerHash(raw: string): Promise<string> {
  const data = new TextEncoder().encode(`${PUZZLE_SALT}:${normalizeAnswer(raw)}`);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Vrai si la réponse soumise matche le hash attendu (validation offline sûre). */
export async function matchAnswerHash(submitted: string, expectedHash: string | null | undefined): Promise<boolean> {
  if (!expectedHash) return false;
  if (normalizeAnswer(submitted).length === 0) return false;
  return (await answerHash(submitted)) === expectedHash;
}
