/**
 * API Route: /api/inngest
 *
 * Endpoint que Inngest Cloud appelle pour exécuter nos fonctions.
 * Le flow :
 *   1. Quelqu'un envoie un event via `inngest.send(...)` → part chez
 *      Inngest Cloud
 *   2. Inngest Cloud trouve quelle(s) fonction(s) consomment cet event
 *   3. Inngest Cloud fait POST /api/inngest avec le step à exécuter
 *   4. Le handler `serve()` route vers la bonne fonction et exécute
 *      UN step à la fois (pas toute la fonction d'un coup)
 *   5. Vercel renvoie le résultat du step à Inngest Cloud
 *   6. Inngest Cloud planifie le step suivant (peut être dans 1ms ou 1h)
 *
 * Authentification : signed via HMAC avec INNGEST_SIGNING_KEY (env var
 * poussée automatiquement par l'intégration Vercel ↔ Inngest).
 *
 * Pour ajouter une nouvelle fonction Inngest :
 *   1. La définir avec `inngest.createFunction(...)` dans `src/lib/inngest/`
 *   2. L'importer ici et l'ajouter au tableau `functions: [...]`
 *   3. À chaque déploiement Vercel, Inngest re-sync la liste auto
 */

import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest-client";
import { allTestFunctions } from "@/lib/inngest/functions-test";

// Inngest n'est PAS un endpoint long-running ; chaque invocation = 1 step.
// Vercel default 10s suffit largement (step typique = 30s-5min mais
// nous reverrons ce timeout au moment de migrer la pipeline réelle).
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    // Tests de bout en bout (à supprimer après stabilisation)
    ...allTestFunctions,
    // TODO J3 : ajouter la fonction `generateGame` ici
    // TODO J5 : ajouter le dead letter handler `handleGenerateGameFailure`
    // TODO J5 : ajouter le heartbeat `recoverStuckGames`
  ],
});
