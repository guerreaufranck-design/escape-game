/*
 * Service worker OddballTrip — mode hors-ligne, SCOPÉ AU PLAYER (/play).
 *
 * Prudence maximale (le site vend en direct) :
 *   - Enregistré uniquement avec scope "/play" → ne contrôle JAMAIS les pages
 *     checkout/marketing. Elles ne passent pas par ce SW.
 *   - Ne touche QUE les requêtes GET. Les mutations API (POST validate-step,
 *     etc.) passent en direct au réseau, jamais interceptées.
 *   - Assets immuables (MP3 ElevenLabs, sprites AR, images, /_next/static) →
 *     cache-first (sûr, ils ne changent pas).
 *   - Navigations (HTML) → network-first : un joueur EN LIGNE a toujours la
 *     version fraîche ; le cache ne sert QUE de secours hors-ligne.
 */
const ASSET_CACHE = "escape-offline-assets-v1";
const SHELL_CACHE = "escape-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== ASSET_CACHE && k !== SHELL_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isImmutableAsset(href) {
  return (
    /\.(mp3|m4a|ogg|png|webp|jpe?g|svg|gif|woff2?)(\?|#|$)/i.test(href) ||
    href.includes("/_next/static/") ||
    href.includes("/storage/v1/object/public/")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // mutations API : jamais touchées

  const url = new URL(req.url);

  // 1) Assets immuables → cache-first
  if (isImmutableAsset(url.href)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch (err) {
          return hit || Response.error();
        }
      })(),
    );
    return;
  }

  // 2) Navigations HTML → network-first (en ligne = toujours frais), cache = secours
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch (err) {
          const hit = await cache.match(req);
          return hit || Response.error();
        }
      })(),
    );
    return;
  }

  // 3) Tout le reste (API GET, etc.) → réseau direct, pas d'interception
});
