"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  setDynamicUIPack,
  subscribeDynamicUI,
  getDynamicUIVersion,
} from "@/lib/translations";
import { isStaticLocale } from "@/lib/i18n";

/**
 * Triggers the dynamic UI pack load for non-static locales (zh/ja/ko/th/
 * vi/hi/id/ms/etc. — Klook Asia push) and forces the calling component to
 * re-render once the pack lands.
 *
 * Static locales (fr/en/de/es/it) skip the network entirely and the hook
 * is a no-op (returns 0).
 *
 * Drop one call near the top of any client page that uses `tt()`. The
 * pack lives in a module-level store so multiple pages share it without
 * duplicate fetches — the localStorage cache makes warm boots instant.
 */
export function useUITranslations(locale: string): number {
  const version = useSyncExternalStore(
    subscribeDynamicUI,
    getDynamicUIVersion,
    () => 0,
  );

  useEffect(() => {
    if (!locale) return;
    if (isStaticLocale(locale)) return;

    let cancelled = false;
    const lc = locale.toLowerCase();
    const cacheKey = `ui_pack_${lc}`;

    // 1. Hydrate from localStorage immediately — instant correct UI on
    //    repeat visits. Server cache is the source of truth so any drift
    //    gets healed by step 2.
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            setDynamicUIPack(lc, parsed as Record<string, string>);
          }
        }
      } catch {
        /* ignore corrupt local cache */
      }
    }

    // 2. Always re-fetch from /api/translations to pick up newly added
    //    keys. Endpoint returns a flat { key: translatedText } map under
    //    data.strings; cache hits are instant, only missing keys hit Gemini.
    fetch(`/api/translations?lang=${lc}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const pack = data?.strings;
        if (pack && typeof pack === "object" && Object.keys(pack).length > 0) {
          setDynamicUIPack(lc, pack);
          try {
            window.localStorage.setItem(cacheKey, JSON.stringify(pack));
          } catch {
            /* quota or private mode — runtime cache still works */
          }
        }
      })
      .catch(() => {
        /* soft fail — falls back to English UI via tt() */
      });

    return () => {
      cancelled = true;
    };
  }, [locale]);

  return version;
}

/**
 * Component wrapper for places where a hook is awkward (e.g. layout files).
 * Calls the hook internally and renders children.
 */
export function UITranslationsProvider({
  locale,
  children,
}: {
  locale: string;
  children: React.ReactNode;
}) {
  useUITranslations(locale);
  return <>{children}</>;
}
