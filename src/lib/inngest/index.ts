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
import { buildGameDurable } from "./build-game";
import { classifyAndRectifyErrorReport } from "./classify-and-rectify";
import { validateDraft } from "./validate-draft";
import { allTestFunctions } from "./functions-test";

export {
  generateGame,
  handleGenerateGameFailure,
  recoverStuckGames,
  buildGameDurable,
  classifyAndRectifyErrorReport,
  validateDraft,
};

/** Toutes les fonctions Inngest actives en production. */
export const allInngestFunctions = [
  // Pipeline de génération
  // - buildGameDurable : pré-insert (discovery + narration + insert)
  //                      consume "game/build.requested"
  // - generateGame     : post-insert (translations + audio + validate
  //                      + publish + callback OddballTrip)
  //                      consume "game/generate.requested"
  buildGameDurable,
  generateGame,
  handleGenerateGameFailure,
  recoverStuckGames,
  // Sprint 6.1 (2026-05-21) — player error reports → LLM classifier
  // → auto-rectify audio OR admin queue.
  // Consume "player/error-report.submitted"
  classifyAndRectifyErrorReport,
  // (2026-05-24) Pré-validation drafts en background (Vercel 300s
  // impossible en sync car Perplexity = 5-10 min)
  // Consume "draft/validate.requested"
  validateDraft,
  // Sanity check end-to-end (à supprimer après stabilisation J+14)
  ...allTestFunctions,
];
