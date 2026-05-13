/**
 * Inngest client — central event bus + durable workflow runner.
 *
 * Why Inngest: la pipeline de génération de jeux est multi-étapes
 * (discovery → insert → translate → audio → validate → repair → publish),
 * chacune longue (30s–5min) et flaky (API externes). Inngest exécute
 * chaque étape comme un "step" durable :
 *   - Si un step plante, retry exponentiel automatique
 *   - Si la lambda Vercel timeout, Inngest redémarre exactement
 *     au step suivant avec les résultats des steps précédents persistés
 *   - Concurrency caps natifs (anti-burst Gemini)
 *   - Dead letter queue après épuisement des retries
 *
 * Doc: https://www.inngest.com/docs
 *
 * Env vars requis (poussés automatiquement par l'intégration Vercel ↔ Inngest):
 *   - INNGEST_EVENT_KEY     (clé pour envoyer des events)
 *   - INNGEST_SIGNING_KEY   (HMAC pour authentifier les webhooks entrants)
 */

import { Inngest, eventType, staticSchema } from "inngest";

/**
 * Catalogue des events que notre pipeline émet/consomme.
 *
 * Le typage utilise `staticSchema` (compile-time only, pas de validation
 * runtime via Zod). Si on veut un jour valider les payloads à la réception,
 * on pourra swap pour un schema Zod sans changer le call site.
 *
 * Convention de nommage : `<domain>/<verb>.<state>`
 *   - game/generate.requested → kickoff de la pipeline
 *   - game/generate.failed    → dead letter (toutes retries épuisées)
 *   - game/generate.succeeded → jeu publié avec succès
 */

/** Demande de finalisation d'un jeu déjà inséré (is_published=false).
 *  Envoyé par /api/games/generate APRÈS l'exécution de Lambda 1
 *  (generateGameFromTemplate qui insère la row + les steps).
 *
 *  La fonction Inngest `generateGame` consume cet event et exécute
 *  durablement : prepareGamePackage → validateFinalGame → attemptAutoRepair
 *  loop → flip is_published → notify OddballTrip via callback. */
export const gameGenerateRequested = eventType("game/generate.requested", {
  schema: staticSchema<{
    /** UUID du game déjà inséré en DB par Lambda 1 (is_published=false). */
    gameId: string;
    /** Slug — utilisé pour les logs et le callback. */
    slug: string;
    /** Langue ISO-639-1 (fr, en, de…) pour la pré-génération audio. */
    language?: string;
    /** Champs métier — utilisés par attemptAutoRepair pour régénérer un step. */
    city: string;
    theme: string;
    narrative: string;
    /** Genre narratif (historical, fantasy, mystery…). */
    genre?: string;
    /** Email du buyer — utilisé pour l'alerte needs_review. */
    buyerEmail?: string;
    /** Order ID OddballTrip — tracking. */
    orderId?: string;
    /** Callback URL OddballTrip — notif success/failure post-finalize. */
    callbackUrl?: string;
    /** Bearer token pour authentifier le callback. */
    callbackSecret?: string;
  }>(),
});

/** Dead letter : la pipeline a échoué malgré tous les retries. Le handler
 *  marque le jeu needs_review=true et envoie une alerte email. */
export const gameGenerateFailed = eventType("game/generate.failed", {
  schema: staticSchema<{
    gameId: string;
    step: string;
    error: string;
    attempts: number;
  }>(),
});

/** Pipeline terminée avec succès, is_published=true. Peut être utilisé
 *  pour notifier OddballTrip via webhook, logger des métriques, etc. */
export const gameGenerateSucceeded = eventType("game/generate.succeeded", {
  schema: staticSchema<{
    gameId: string;
    durationMs: number;
  }>(),
});

/** Heartbeat — utilisé par le cron filet de sécurité pour ré-amorcer
 *  les jeux stuck (au cas où Inngest lui-même aurait perdu un event). */
export const pipelineHeartbeatCheck = eventType(
  "internal/pipeline.heartbeat-check",
  {
    schema: staticSchema<Record<string, never>>(),
  },
);

export const inngest = new Inngest({
  id: "escape-game",
});
