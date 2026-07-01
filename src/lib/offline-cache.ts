/**
 * OFFLINE CACHE (client) — stocke le "pack" d'un jeu pour jouer sans réseau.
 *
 * Deux stockages complémentaires :
 *   1. IndexedDB  → le CONTENU du jeu (session + steps + réponses + indices +
 *      GPS + textes traduits) = le JSON renvoyé par GET /api/game/[sessionId].
 *   2. Cache API  → les ASSETS binaires (MP3 ElevenLabs, sprites AR, images),
 *      pré-téléchargés pendant qu'on a du réseau, resservis offline par le SW.
 *
 * Tout est no-op côté serveur (SSR) : on garde sur `typeof window`.
 * Aucune dépendance externe. Non branché tant que la page player ne l'appelle
 * pas → zéro impact sur l'existant.
 */

const DB_NAME = "escape-offline";
const STORE = "packages";
const ASSET_CACHE = "escape-offline-assets-v1";

function available(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Sauve le pack de contenu d'une session. */
export async function savePackage(sessionId: string, pkg: unknown): Promise<void> {
  if (!available()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ pkg, savedAt: Date.now() }, sessionId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Récupère le pack de contenu d'une session (ou null). */
export async function loadPackage<T = unknown>(sessionId: string): Promise<T | null> {
  if (!available()) return null;
  const db = await openDb();
  const val = await new Promise<{ pkg: T } | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(sessionId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return val?.pkg ?? null;
}

/** Vrai si un pack est déjà en cache pour cette session. */
export async function hasPackage(sessionId: string): Promise<boolean> {
  return (await loadPackage(sessionId)) !== null;
}

/**
 * Extrait toutes les URLs d'assets (audio/images) d'un pack, en parcourant
 * récursivement le JSON. Robuste à la forme exacte du pack.
 */
export function collectAssetUrls(pkg: unknown): string[] {
  const out = new Set<string>();
  const isAsset = (s: string) =>
    /^https?:\/\//i.test(s) && /\.(mp3|m4a|ogg|png|webp|jpe?g|svg|gif)(\?|#|$)/i.test(s);
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (isAsset(v)) out.add(v);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x);
    }
  };
  walk(pkg);
  return [...out];
}

/**
 * Pré-télécharge les assets dans la Cache API (à appeler EN LIGNE, à
 * l'activation/au démarrage de session). Concurrence limitée. Renvoie le
 * nombre d'assets mis en cache. Les échecs individuels sont tolérés.
 */
export async function warmAssets(
  urls: string[],
  concurrency = 6,
): Promise<{ ok: number; failed: number }> {
  if (typeof window === "undefined" || typeof caches === "undefined") {
    return { ok: 0, failed: urls.length };
  }
  const cache = await caches.open(ASSET_CACHE);
  let ok = 0;
  let failed = 0;
  let idx = 0;
  async function worker() {
    while (idx < urls.length) {
      const url = urls[idx++];
      try {
        const existing = await cache.match(url);
        if (existing) {
          ok++;
          continue;
        }
        const res = await fetch(url, { mode: "cors" });
        if (res.ok) {
          await cache.put(url, res.clone());
          ok++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  return { ok, failed };
}

/** Supprime le pack + les assets d'une session (nettoyage). */
export async function clearPackage(sessionId: string): Promise<void> {
  if (!available()) return;
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(sessionId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

export const OFFLINE_ASSET_CACHE = ASSET_CACHE;
