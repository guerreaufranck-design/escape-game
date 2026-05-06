/**
 * Override de genre par slug — utilitaire de TEST MVP.
 *
 * Permet de forcer un genre narratif sur une fiche EXISTANTE d'oddballtrip
 * sans modifier l'appel API côté oddballtrip. Workflow :
 *   1. Tu veux tester "aegina-tortues-argent" en mode mystery.
 *   2. Tu ajoutes l'entrée ci-dessous : `"aegina-tortues-argent": "mystery"`.
 *   3. Tu wipes le game existant côté DB (scripts/wipe-all-games.ts ou
 *      delete by slug — sinon la garde d'idempotence retourne l'ancien
 *      jeu sans régénérer).
 *   4. Tu déclenches la génération depuis oddballtrip normalement.
 *   5. Le pipeline log [Pipeline] Genre: mystery (slug override).
 *
 * Une fois le MVP validé / invalidé, ce fichier est supprimé d'un
 * `git rm` — la voie propre passera par body.genre transmis par
 * oddballtrip + col DB (Phase 2).
 *
 * NE PAS coupler à la logique métier — c'est un harness de test
 * éphémère, pas une feature.
 */

import type { GameGenre } from "./game-genres";

/**
 * Map slug → genre. Édite ce dict au fil des tests. Vide = pas
 * d'override actif (pipeline reste sur body.genre / fallback historical).
 */
export const GENRE_OVERRIDES: Record<string, GameGenre> = {
  // Slugs des 7 jeux publiés (snapshot 2026-05-06). Couverture de 4
  // genres distincts pour le test MVP. Édite pour ajouter/changer.
  "les-tortues-d-argent": "mystery",                 // Aegina (hôtels = scènes de crime)
  "le-phare-de-saint-mathieu": "espionnage",         // Brest (rade militaire, cold-war)
  "jan-palach-l-appel-des-cendres": "supernatural",  // Prague (fantômes, vieille ville)
  "le-secret-des-remparts-de-rothenburg": "fantasy", // Rothenburg (ville fortifiée médiévale)
  // Restent en `historical` par défaut (pas d'override) :
  //   le-secret-de-bothwell                 (Bothwell)
  //   les-murmures-de-la-tour-londres       (London)
  //   la-mystique-de-sainte-therese         (Ávila)
};

/** Récupère un override de genre pour un slug. Retourne undefined si
 *  aucun override actif — laisse le pipeline retomber sur body.genre. */
export function getGenreOverride(slug: string): GameGenre | undefined {
  return GENRE_OVERRIDES[slug];
}

/**
 * Override de stopCount par slug — utile pour les fiches dont la zone
 * est géographiquement maigre (Aegina, Brest...) où 8 stops walkables
 * sont impossibles. Avec un stopCount plus bas, le pipeline étend
 * automatiquement le rayon de recherche et la distance max inter-stop
 * (cf. parcours-discovery.ts) — la DURÉE du jeu reste constante (~90 min)
 * mais avec moins d'étapes plus espacées, fidèle au pitch "tour de
 * ville en jouant".
 *
 * Map vide par défaut. Le pipeline reste sur body.stopCount tant qu'on
 * n'ajoute pas d'entrée.
 */
export const STOPCOUNT_OVERRIDES: Record<string, number> = {
  // Aegina Town — zone sparse (Temple Aphaia hors centre, peu de POIs
  // intra-muros). 5 stops + hops étirés = 90 min de marche couvrant
  // l'île plutôt que 8 stops infaisables.
  "les-tortues-d-argent": 5,
};

/** Récupère un override de stopCount pour un slug. Retourne undefined
 *  si aucun override actif. */
export function getStopCountOverride(slug: string): number | undefined {
  return STOPCOUNT_OVERRIDES[slug];
}
