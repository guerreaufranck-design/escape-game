/**
 * Blacklists d'answers pour les indices (per-stop) ET le final answer.
 *
 * Extracted from anthropic.ts (generateFinalRiddle) on 2026-05-17 so the
 * post-publish validator (pipeline-validators.ts) peut appliquer les
 * mêmes guards, indépendamment du moment de génération. Source de vérité
 * unique : si on ajoute un mot dans WEAK_ANSWERS ici, les deux call sites
 * le rejettent.
 *
 * Politique :
 *   - WEAK_ANSWERS : mots génériques type "secret" / "mystery" qui peuvent
 *     coller à n'importe quel jeu et qui donnent un final sans saveur.
 *     Rejet hard à la génération + warning à la validation.
 *   - KNOWN_FAKE_TOKENS : néologismes inventés par Claude qui ressemblent
 *     à du latin mais ne sont dans aucun dictionnaire (favagis, geverus...).
 *     Rejet hard ici aussi.
 *
 * Une chaîne est testée après normalisation : `trim().toLowerCase()`.
 */

export const WEAK_ANSWERS: ReadonlySet<string> = new Set([
  "renaissance", "harmonie", "harmony", "destinée", "destinee", "destiny",
  "éternité", "eternity", "unity", "unité", "memory", "mémoire",
  "victory", "freedom", "liberty", "secret", "mystère", "mystery",
  "magic", "magie", "wonder", "merveille", "essence", "spirit", "esprit",
  "soul", "âme", "ame", "journey", "voyage", "discovery", "découverte",
  "decouverte",
]);

export const KNOWN_FAKE_TOKENS: ReadonlySet<string> = new Set([
  "favagis", "geverus", "loritas", "vinctum",
]);

export function isWeakAnswer(answer: string): boolean {
  return WEAK_ANSWERS.has(answer.trim().toLowerCase());
}

export function isFakeToken(answer: string): boolean {
  return KNOWN_FAKE_TOKENS.has(answer.trim().toLowerCase());
}
