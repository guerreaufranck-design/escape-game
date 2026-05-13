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
import { allInngestFunctions } from "@/lib/inngest";

/**
 * Vercel maxDuration de cet endpoint.
 *
 * Chaque invocation d'Inngest = exécution d'UN seul step. Le step le plus
 * long est `prepare-package` qui peut prendre 5-10 min (translations
 * Gemini + audio ElevenLabs). On met 600s (10 min, max Vercel) pour
 * couvrir tous les cas. Si un step dépasse 10 min, Inngest le retry
 * automatiquement.
 */
export const maxDuration = 600;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: allInngestFunctions,
});
