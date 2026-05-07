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

/** Strip les diacritiques pour normalisation tolérante :
 *  "cinéma" → "cinema", "mystère" → "mystere", "conte de fées" → "conte de fees". */
function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Table d'alias FR/EN/synonymes → clé canonique GameGenre.
 *
 * oddballtrip stocke ses `viable_genres` audit Gemini en français
 * (`historique`, `polar`, `fantastique`...). Plutôt que de faire un
 * massive UPDATE DB côté oddballtrip, on accepte les deux langues +
 * synonymes courants ici. Côté pipeline c'est transparent : tout est
 * normalisé vers la clé canonique anglaise utilisée par genre-templates.ts.
 *
 * Les clés de cette map sont déjà normalisées (lowercase + diacritiques
 * stripés). Cf. `parseGenre()` pour le pipeline d'application.
 */
const GENRE_ALIASES: Record<string, GameGenre> = {
  // === Canonical anglais (identité) ===
  historical: "historical",
  mystery: "mystery",
  fantasy: "fantasy",
  romance: "romance",
  supernatural: "supernatural",
  espionnage: "espionnage",
  cinema: "cinema",
  fairytale: "fairytale",

  // === Aliases français (audit Gemini oddballtrip) ===
  historique: "historical",
  history: "historical",
  polar: "mystery",
  mystere: "mystery", // "mystère" après stripDiacritics
  policier: "mystery",
  fantastique: "fantasy",
  fantastic: "fantasy",
  romantique: "romance",
  surnaturel: "supernatural",
  paranormal: "supernatural",
  fantome: "supernatural", // "fantôme"
  fantomes: "supernatural",
  espionage: "espionnage", // typo courant en EN
  spy: "espionnage",
  conte: "fairytale",
  "conte de fees": "fairytale", // "conte de fées" après stripDiacritics
  "conte-de-fees": "fairytale",
  fairy: "fairytale",
  "fairy-tale": "fairytale",
};

/**
 * Parse une valeur d'entrée (body API ou viable_genres oddballtrip)
 * vers un GameGenre canonique. Tolérant :
 *   - case-insensitive ("HISTORIQUE" = "historique")
 *   - accents stripés ("Cinéma" = "cinema")
 *   - français + anglais + synonymes (cf. GENRE_ALIASES)
 *
 * Fallback `historical` si la valeur n'est pas reconnue (sécurise les
 * cas Gemini-hallucinated comme "aventure" qui sortent du catalogue).
 *
 * Exemples :
 *   parseGenre("polar")      → "mystery"
 *   parseGenre("Historique") → "historical"
 *   parseGenre("conte de fées") → "fairytale"
 *   parseGenre("aventure")   → "historical" (inconnu, fallback)
 *   parseGenre(null)         → "historical"
 */
export function parseGenre(value: unknown): GameGenre {
  if (typeof value !== "string") return DEFAULT_GENRE;
  const normalized = stripDiacritics(value.toLowerCase().trim());
  if (normalized in GENRE_ALIASES) return GENRE_ALIASES[normalized];
  return DEFAULT_GENRE;
}
