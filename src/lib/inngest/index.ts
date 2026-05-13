/**
 * Catalogue des fonctions Inngest de l'app.
 *
 * Toute nouvelle fonction Inngest DOIT être importée + ré-exportée ici,
 * et ajoutée au tableau `allInngestFunctions` qui est passé au handler
 * dans `/api/inngest/route.ts`. Inngest Cloud re-sync la liste à chaque
 * déploiement Vercel.
 */

import { generateGame } from "./generate-game";
import { handleGenerateGameFailure } from "./dead-letter";
import { recoverStuckGames } from "./heartbeat";
import { allTestFunctions } from "./functions-test";

export { generateGame, handleGenerateGameFailure, recoverStuckGames };

/** Toutes les fonctions Inngest actives en production. */
export const allInngestFunctions = [
  // Pipeline de génération
  generateGame,
  handleGenerateGameFailure,
  recoverStuckGames,
  // Sanity check end-to-end (à supprimer après stabilisation J+14)
  ...allTestFunctions,
];
