/**
 * Catalogue des genres narratifs proposés par OddballTrip.
 *
 * Le `genre` détermine la tonalité du jeu généré (riddle, mot magique,
 * personnage AR par défaut, registre de l'épilogue) sans toucher aux
 * stops réels — Google Places + curation Claude restent inchangés. Le
 * même set de POIs peut être joué en `historical`, `mystery`, `fantasy`…
 *
 * MVP : le genre est transmis dans le body API + propagé dans le
 * pipeline en mémoire UNIQUEMENT. Pas de colonne DB — si l'expérience
 * narrative ne tient pas, on revert via `git revert` sans downgrade
 * de schéma. Si elle tient, on migre en Phase 2.
 */

export type GameGenre =
  | "historical"
  | "fantasy"
  | "mystery"
  | "romance"
  | "supernatural"
  | "espionnage"
  | "cinema"
  | "fairytale";

export const ALL_GENRES: readonly GameGenre[] = [
  "historical",
  "fantasy",
  "mystery",
  "romance",
  "supernatural",
  "espionnage",
  "cinema",
  "fairytale",
] as const;

export const DEFAULT_GENRE: GameGenre = "historical";

export function isValidGenre(value: unknown): value is GameGenre {
  return (
    typeof value === "string" &&
    (ALL_GENRES as readonly string[]).includes(value)
  );
}

/** Parse une valeur d'entrée (body API typiquement) vers un GameGenre
 *  valide, fallback `historical` sinon. Idempotent et tolérant à la casse. */
export function parseGenre(value: unknown): GameGenre {
  if (typeof value !== "string") return DEFAULT_GENRE;
  const lower = value.toLowerCase().trim();
  if (isValidGenre(lower)) return lower;
  return DEFAULT_GENRE;
}
