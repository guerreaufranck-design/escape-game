/**
 * Alias canonique : POST /api/external/generate-game → /api/generate-game
 *
 * Cohérence avec /api/external/generate-code et /api/external/validate-code
 * qui sont les endpoints publics consommés par oddballtrip — le namespace
 * /api/external/ regroupe tous les endpoints externes côté PWA, vs
 * /api/generate-game qui était l'endpoint historique non-namespaced.
 *
 * Tous les sites qui appellent /api/games/generate ou /api/generate-game
 * continuent de fonctionner — les 3 routes pointent sur la même
 * implémentation.
 */

export { POST } from "@/app/api/generate-game/route";
export const maxDuration = 600;
