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

/**
 * BUILD-FROM-SCRATCH event (vision 2026-05-16, post-Aegina incident).
 *
 * Émis par /api/external/generate-game LORSQUE le payload OddballTrip
 * arrive. Au lieu de runFullPipeline synchrone (qui timeout Vercel à
 * 13 min en cas de Gemini saturé), on émet cet event et on retourne
 * 200 immédiatement à OddballTrip.
 *
 * Inngest fonction `buildGameDurable` consume cet event et tourne sans
 * limite de durée Vercel, avec retry par step et observabilité totale.
 *
 * Quand la pipeline est terminée (publish + callback), OddballTrip qui
 * polle find-game reçoit enfin le gameId.
 */
export const gameBuildRequested = eventType("game/build.requested", {
  schema: staticSchema<{
    /** Slug fourni par OddballTrip (clé identité côté leur catalogue). */
    slug: string;
    /** Titre du jeu (thème). */
    title: string;
    /** Ville texte (peut être enrichie : "Aegina Island, Saronic Gulf"). */
    city: string;
    /** Pays (peut être déduit côté pipeline si vide). */
    country?: string;
    /** Description du thème — passée à Claude pour la narration. */
    themeDescription: string;
    /** Narrative custom (optional) — Claude l'adapte si non fournie. */
    narrative?: string;
    /** 1-5 — déterminer la complexité des énigmes. */
    difficulty?: number;
    /** Durée moyenne attendue en minutes. */
    estimatedDurationMin?: number;
    /** Nombre de stops cible (default 8). */
    stopCount?: number;
    /** Genre narratif (historical, fantasy, mystery…). */
    genre?: string;
    /** Langue ISO-639-1 du client (fr, en, de…). */
    language?: string;
    /** Mode de transport (walking par défaut, mixed/driving si configuré). */
    transportMode?: "walking" | "driving" | "mixed";
    /**
     * S9 (2026-05-18) — Type de jeu produit :
     *   - city_game (default) : escape game classique avec énigmes
     *   - city_tour : audioguide enrichi (narration encyclopédique,
     *     pas d'énigmes, AR pour orientation conservée)
     */
    mode?: "city_game" | "city_tour";
    /** Rayon en km pour mode roadtrip. */
    radiusKm?: number;
    /** Jours recommandés (mode roadtrip). */
    recommendedDaysMin?: number;
    recommendedDaysMax?: number;
    /** Point de départ texte (geocodé côté pipeline). */
    startPointText?: string;
    /** Coords explicites (override le géocodage texte). */
    startPointLat?: number;
    startPointLon?: number;
    /** Identifiants OddballTrip pour callback final. */
    buyerEmail?: string;
    orderId?: string;
    callbackUrl?: string;
    callbackSecret?: string;
    /** Accessibility (free vs any). */
    accessibility?: "free" | "any";
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
