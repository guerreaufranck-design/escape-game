/**
 * Alias: POST /api/games/generate → /api/generate-game
 * Oddballtrip calls this URL, so we proxy to the actual endpoint.
 */

export { POST } from "@/app/api/generate-game/route";
export const maxDuration = 600;
