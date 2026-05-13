/**
 * Fonctions Inngest de test — valident la connectivité end-to-end avant
 * de migrer la pipeline réelle.
 *
 * À supprimer après que la migration soit stabilisée (J+14).
 */

import { inngest, pipelineHeartbeatCheck } from "@/lib/inngest-client";

/**
 * Ping de bout en bout : déclenché par l'event `internal/pipeline.heartbeat-check`,
 * fait juste 2 steps avec un sleep pour valider que :
 *   1. Inngest reçoit notre event
 *   2. Inngest appelle notre /api/inngest endpoint
 *   3. step.run persiste bien les résultats entre invocations
 *   4. step.sleep fonctionne (Inngest re-invoque après le délai)
 *
 * Pour le déclencher manuellement depuis le dashboard Inngest :
 *   Events → Send Event → name: "internal/pipeline.heartbeat-check"
 */
export const helloWorldTest = inngest.createFunction(
  {
    id: "hello-world-test",
    name: "Hello world (sanity check)",
    triggers: [{ event: pipelineHeartbeatCheck }],
  },
  async ({ step, logger }) => {
    const greeting = await step.run("say-hello", async () => {
      logger.info("Step 1: greeting");
      return { message: "Hello from Inngest!" };
    });

    // Sleep 5s — démontre la durabilité : Inngest tue la lambda,
    // attend 5s, puis re-invoque sur le step suivant.
    await step.sleep("wait-a-bit", "5s");

    const farewell = await step.run("say-goodbye", async () => {
      logger.info("Step 2: farewell, with greeting from step 1", greeting);
      return {
        message: `Got: "${greeting.message}". Goodbye!`,
        timestamp: new Date().toISOString(),
      };
    });

    return { greeting, farewell };
  },
);

/** Toutes les fonctions Inngest exportées doivent être listées ici
 *  et passées au handler dans /api/inngest/route.ts. */
export const allTestFunctions = [helloWorldTest];
