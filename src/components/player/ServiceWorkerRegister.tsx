"use client";

import { useEffect } from "react";

/**
 * Enregistre le service worker HORS-LIGNE avec un scope **restreint à /play**.
 *
 * Conséquence : le SW ne contrôle QUE les pages de jeu. Les pages
 * checkout/marketing (hors /play) ne passent jamais par lui → zéro risque
 * pour les ventes en cours. Rendu `null` (aucun UI).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/play", updateViaCache: "none" })
      .catch((err) => {
        // Non bloquant : si l'enregistrement échoue, le jeu marche en ligne
        // comme avant.
        console.warn("[sw] register failed:", err);
      });
  }, []);

  return null;
}
