"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface SupportMessage {
  id: string;
  from_admin: boolean;
  text: string;
  read_at: string | null;
  created_at: string;
}

/**
 * useSupportMessages
 *
 * Poll /api/game/[sessionId]/messages toutes les 15 sec pour récupérer
 * les messages support envoyés par l'admin. Retourne :
 *   - newMessages : messages non encore "vus" (queue à afficher en overlay)
 *   - dismiss(id) : appelé quand le joueur tape "Compris" → POST read +
 *                   retire de la queue
 *
 * Pattern queue : si l'admin envoie 2 messages d'un coup, on les
 * affiche en cascade (l'un après l'autre) pour ne pas tout empiler.
 *
 * Désactivation : si enabled=false ou sessionId vide, no-op.
 */

const POLL_INTERVAL_MS = 15_000;

export function useSupportMessages(
  sessionId: string | null | undefined,
  enabled: boolean,
) {
  const [queue, setQueue] = useState<SupportMessage[]>([]);
  const lastSeenIdRef = useRef<string | null>(null);
  // Pour ne pas re-empiler un message qu'on a déjà dans la queue
  const knownIdsRef = useRef<Set<string>>(new Set());

  const fetchNew = useCallback(async () => {
    if (!sessionId || !enabled) return;
    try {
      const url = lastSeenIdRef.current
        ? `/api/game/${sessionId}/messages?since_id=${lastSeenIdRef.current}`
        : `/api/game/${sessionId}/messages`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { messages: SupportMessage[] };
      const fresh = (data.messages ?? []).filter(
        (m) => !knownIdsRef.current.has(m.id),
      );
      if (fresh.length > 0) {
        for (const m of fresh) knownIdsRef.current.add(m.id);
        lastSeenIdRef.current = fresh[fresh.length - 1].id;
        setQueue((prev) => [...prev, ...fresh]);
        // Vibration douce pour signaler la réception (si supporté)
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          try {
            navigator.vibrate?.([100, 50, 100]);
          } catch {
            /* silently ignore */
          }
        }
      }
    } catch {
      /* network errors silent — retry next poll */
    }
  }, [sessionId, enabled]);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    fetchNew();
    const iv = setInterval(fetchNew, POLL_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [enabled, sessionId, fetchNew]);

  const dismiss = useCallback(
    async (messageId: string) => {
      // Optimistic remove from queue
      setQueue((prev) => prev.filter((m) => m.id !== messageId));
      if (!sessionId) return;
      // POST read fire-and-forget
      fetch(`/api/game/${sessionId}/messages/${messageId}/read`, {
        method: "POST",
        keepalive: true,
      }).catch(() => {
        /* ignore */
      });
    },
    [sessionId],
  );

  return { queue, dismiss };
}
