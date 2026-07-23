/**
 * OFFLINE PLAY (client) — pré-télécharge un jeu complet et gère la progression
 * hors-ligne.
 *
 * Flux :
 *   1. EN LIGNE, au démarrage : prefetchFullGame() boucle GET ?step=1..N,
 *      stocke chaque étape (IndexedDB) + warm les audios/sprites (Cache API).
 *   2. HORS-LIGNE : la page player lit l'étape depuis le pack, valide avec
 *      matchAnswer (arFacadeText = la réponse pour les jeux AR), avance en
 *      local, et met les complétions en file.
 *   3. AU RETOUR DU RÉSEAU : flushQueue() rejoue start + validate-step pour
 *      synchroniser le serveur (best-effort).
 */
import type { GameState } from "@/types/game";
import { savePackage, loadPackage, warmAssets, collectAssetUrls } from "@/lib/offline-cache";
import { getSpriteUrl, AR_POSES } from "@/lib/ar-sprites";

export interface FullPack {
  savedAt: number;
  locale: string;
  totalSteps: number;
  /** payload GET par step_order (1..N). */
  steps: Record<number, GameState>;
}

type QueuedAction =
  | { type: "start"; at: number }
  | { type: "complete"; stepOrder: number; answer: string; at: number }
  | { type: "skip"; stepOrder: number; at: number }
  | { type: "final"; answer: string; at: number };

const stepKey = (sessionId: string) => `offline:${sessionId}:step`;
const queueKey = (sessionId: string) => `offline:${sessionId}:queue`;
const doneKey = (sessionId: string) => `offline:${sessionId}:done`;

/**
 * Pré-télécharge TOUT le jeu (à appeler EN LIGNE).
 *
 * Robuste (2026-07-23, après blocage client Pézenas) : chaque étape est
 * retentée jusqu'à 3× (réseau capricieux), et on RÉUTILISE le pack déjà en
 * cache pour ne re-télécharger que les étapes manquantes. Idempotent : peut
 * être rappelé au retour du réseau jusqu'à ce que tout soit là.
 * `onProgress(done, total)` remonte l'avancement pour l'UI.
 */
export async function prefetchFullGame(
  sessionId: string,
  locale: string,
  totalSteps: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ steps: number; assets: { ok: number; failed: number } }> {
  // Repart du pack existant → on ne refait que les étapes manquantes.
  const existing = await loadFullPack(sessionId).catch(() => null);
  const steps: Record<number, GameState> = existing?.steps ? { ...existing.steps } : {};
  const assetUrls = new Set<string>();
  onProgress?.(Object.keys(steps).length, totalSteps);
  for (let n = 1; n <= totalSteps; n++) {
    if (steps[n]) {
      for (const u of collectAssetUrls(steps[n])) assetUrls.add(u);
      continue; // déjà en cache
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`/api/game/${sessionId}?lang=${locale}&step=${n}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as GameState;
        steps[n] = data;
        for (const u of collectAssetUrls(data)) assetUrls.add(u);
        onProgress?.(Object.keys(steps).length, totalSteps);
        break; // succès → étape suivante
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  // Sprites AR des personnages : leurs URLs sont construites côté client
  // (pas dans le JSON), donc collectAssetUrls ne les voit pas. On les ajoute
  // ici (toutes poses) pour que le "cercle" du perso s'affiche hors-ligne.
  const types = new Set<string>();
  for (const s of Object.values(steps)) {
    const t = s.arCharacter?.type;
    if (t && t.toLowerCase() !== "default") types.add(t.toLowerCase());
  }
  for (const t of types) {
    for (const pose of AR_POSES) {
      const u = getSpriteUrl(t, pose);
      if (u) assetUrls.add(u);
    }
  }
  const pack: FullPack = { savedAt: Date.now(), locale, totalSteps, steps };
  await savePackage(sessionId, pack);
  const assets = await warmAssets([...assetUrls]);
  return { steps: Object.keys(steps).length, assets };
}

export async function loadFullPack(sessionId: string): Promise<FullPack | null> {
  return loadPackage<FullPack>(sessionId);
}

/** Vrai si le jeu est entièrement pré-téléchargé (toutes les étapes). */
export async function isFullyCached(sessionId: string): Promise<boolean> {
  const pack = await loadFullPack(sessionId);
  return !!pack && Object.keys(pack.steps).length >= pack.totalSteps && pack.totalSteps > 0;
}

// ── Progression locale (localStorage, synchrone) ─────────────────────────────

function ls(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function getOfflineStep(sessionId: string, fallback: number): number {
  const s = ls();
  const raw = s?.getItem(stepKey(sessionId));
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

export function setOfflineStep(sessionId: string, step: number): void {
  ls()?.setItem(stepKey(sessionId), String(step));
}

export function getCompletedOffline(sessionId: string): number[] {
  try {
    return JSON.parse(ls()?.getItem(doneKey(sessionId)) || "[]");
  } catch {
    return [];
  }
}

/** Enregistre une complétion offline (progression + file de sync). */
export function markCompletedOffline(sessionId: string, stepOrder: number, answer: string): void {
  const s = ls();
  if (!s) return;
  const done = new Set(getCompletedOffline(sessionId));
  done.add(stepOrder);
  s.setItem(doneKey(sessionId), JSON.stringify([...done]));
  const q = getQueue(sessionId);
  q.push({ type: "complete", stepOrder, answer, at: Date.now() });
  s.setItem(queueKey(sessionId), JSON.stringify(q));
}

export function queueStart(sessionId: string): void {
  const s = ls();
  if (!s) return;
  const q = getQueue(sessionId);
  if (!q.some((a) => a.type === "start")) q.push({ type: "start", at: Date.now() });
  s.setItem(queueKey(sessionId), JSON.stringify(q));
}

/** Enregistre la soumission du CODE FINAL offline (file de sync). */
export function queueFinal(sessionId: string, answer: string): void {
  const s = ls();
  if (!s) return;
  const q: QueuedAction[] = getQueue(sessionId).filter((a) => a.type !== "final");
  q.push({ type: "final", answer, at: Date.now() });
  s.setItem(queueKey(sessionId), JSON.stringify(q));
}

/** Enregistre un SKIP offline (progression + file de sync). */
export function queueSkip(sessionId: string, stepOrder: number): void {
  const s = ls();
  if (!s) return;
  const done = new Set(getCompletedOffline(sessionId));
  done.add(stepOrder);
  s.setItem(doneKey(sessionId), JSON.stringify([...done]));
  const q = getQueue(sessionId);
  q.push({ type: "skip", stepOrder, at: Date.now() });
  s.setItem(queueKey(sessionId), JSON.stringify(q));
}

function getQueue(sessionId: string): QueuedAction[] {
  try {
    return JSON.parse(ls()?.getItem(queueKey(sessionId)) || "[]");
  } catch {
    return [];
  }
}

/**
 * Rejoue la file au serveur (à appeler quand le réseau revient). Best-effort ;
 * on vide la file seulement si tout a été accepté (sinon on retentera).
 */
export async function flushQueue(sessionId: string, locale: string): Promise<boolean> {
  const s = ls();
  if (!s) return true;
  const q = getQueue(sessionId);
  if (q.length === 0) return true;
  let allOk = true;
  // start d'abord
  for (const a of q.filter((x) => x.type === "start")) {
    try {
      await fetch(`/api/game/${sessionId}/start`, { method: "POST" });
    } catch {
      allOk = false;
    }
  }
  // puis les avancées (validations + skips) dans l'ordre des étapes
  const advances = q
    .filter(
      (x): x is Extract<QueuedAction, { type: "complete" | "skip" }> =>
        x.type === "complete" || x.type === "skip",
    )
    .sort((a, b) => a.stepOrder - b.stepOrder);
  for (const a of advances) {
    try {
      if (a.type === "complete") {
        await fetch(`/api/game/${sessionId}/validate-step?lang=${locale}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepOrder: a.stepOrder, answer: a.answer }),
        });
      } else {
        await fetch(`/api/game/${sessionId}/skip-step?lang=${locale}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepOrder: a.stepOrder }),
        });
      }
    } catch {
      allOk = false;
    }
  }
  // enfin, le code final (une seule soumission)
  const finalAction = q.find(
    (x): x is Extract<QueuedAction, { type: "final" }> => x.type === "final",
  );
  if (finalAction) {
    try {
      await fetch(`/api/game/${sessionId}/final-answer?lang=${locale}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: finalAction.answer }),
      });
    } catch {
      allOk = false;
    }
  }
  if (allOk) s.removeItem(queueKey(sessionId));
  return allOk;
}
