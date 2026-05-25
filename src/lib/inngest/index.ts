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
import { buildGameV2 } from "./build-game-v2";
import { classifyAndRectifyErrorReport } from "./classify-and-rectify";
import { validateDraft } from "./validate-draft";
import { allTestFunctions } from "./functions-test";

export {
  generateGame,
  handleGenerateGameFailure,
  recoverStuckGames,
  buildGameDurable,
  buildGameV2,
  classifyAndRectifyErrorReport,
  validateDraft,
};

/** Toutes les fonctions Inngest actives en production. */
export const allInngestFunctions = [
  // Pipeline de génération
  // - buildGameDurable : v1 (legacy) — discovery via Perplexity sonar-deep-research
  //                      consume "game/build.requested" SI pipelineVersion!=v2
  // - buildGameV2      : v2 (2026-05-25) — Perplexity sonar standard, FR-first,
  //                      respect du buyer payload, Google Places anti-bias,
  //                      Quality Gate + needs_review humain in loop
  //                      consume "game/build.requested" SI pipelineVersion=v2
  // - generateGame     : post-insert legacy (translations + audio + validate
  //                      + publish + callback OddballTrip) — utilisé par v1 only
  //                      consume "game/generate.requested"
  buildGameDurable,
  buildGameV2,
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
