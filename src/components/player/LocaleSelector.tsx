'use client';

import { useState, useEffect, useCallback } from 'react';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from '@/lib/i18n';
import { ui } from '@/lib/translations';
import type { StaticLocale } from '@/lib/i18n';

function getBrowserLocale(): string {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const lang = navigator.language.slice(0, 2).toLowerCase();
  const found = SUPPORTED_LOCALES.find(l => l.code === lang);
  return found ? lang : DEFAULT_LOCALE;
}

export function useLocale(): [string, (l: string) => void] {
  const [locale, setLocaleState] = useState<string>(DEFAULT_LOCALE);

  useEffect(() => {
    // Resolution order:
    //   1. URL ?lang=xx  — set by the activation email when language was
    //      chosen at purchase. Wins over localStorage so the player lands
    //      directly in the correct locale even on a shared device.
    //   2. localStorage  — sticky choice from a previous session
    //   3. browser language fallback
    if (typeof window !== "undefined") {
      const urlLang = new URLSearchParams(window.location.search).get("lang");
      if (urlLang && /^[a-z]{2}$/i.test(urlLang)) {
        const normalized = urlLang.toLowerCase();
        setLocaleState(normalized);
        localStorage.setItem("escape-game-locale", normalized);
        return;
      }
    }
    const stored = localStorage.getItem('escape-game-locale');
    if (stored) {
      setLocaleState(stored);
    } else {
      setLocaleState(getBrowserLocale());
    }
  }, []);

  const setLocale = useCallback((l: string) => {
    setLocaleState(l);
    localStorage.setItem('escape-game-locale', l);
  }, []);

  return [locale, setLocale];
}

const STATIC_LOCALE_SET = new Set(['fr', 'en', 'de', 'es', 'it']);

/**
 * Hook to load translated UI strings.
 * For static locales (fr/en/de/es/it), returns instantly from translations.ts.
 * For dynamic locales (zh, ja, etc.), fetches from /api/translations and caches in localStorage.
 */
export function useTranslatedUI(locale: string): {
  tt: (key: string) => string;
  loading: boolean;
} {
  const [dynamicStrings, setDynamicStrings] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);

  const isStatic = STATIC_LOCALE_SET.has(locale);

  useEffect(() => {
    if (isStatic) {
      setDynamicStrings(null);
      return;
    }

    // Check localStorage cache first
    const cacheKey = `escape-game-ui-${locale}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && Object.keys(parsed).length > 0) {
          setDynamicStrings(parsed);
          return;
        }
      } catch {
        // Invalid cache, fetch fresh
      }
    }

    // Fetch from API
    setLoading(true);
    fetch(`/api/translations?lang=${locale}`)
      .then(r => r.json())
      .then(data => {
        if (data.strings && Object.keys(data.strings).length > 0) {
          setDynamicStrings(data.strings);
          localStorage.setItem(cacheKey, JSON.stringify(data.strings));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [locale, isStatic]);

  const ttFn = useCallback((key: string): string => {
    if (isStatic) {
      const entry = ui[key];
      if (!entry) return key;
      return entry[locale as StaticLocale] || entry.en || entry.fr || key;
    }

    // Use dynamic translations
    if (dynamicStrings && dynamicStrings[key]) {
      return dynamicStrings[key];
    }

    // Fallback to English while loading
    const entry = ui[key];
    if (!entry) return key;
    return entry.en || entry.fr || key;
  }, [locale, isStatic, dynamicStrings]);

  return { tt: ttFn, loading };
}

export function LocaleSelector() {
  const [locale, setLocale] = useLocale();
  const [open, setOpen] = useState(false);

  const currentLang = SUPPORTED_LOCALES.find(l => l.code === locale);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm transition-colors"
      >
        <span>{currentLang?.flag || '\u{1F310}'}</span>
        <span className="hidden sm:inline text-zinc-300">{currentLang?.label || locale}</span>
        <svg className="w-3 h-3 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden min-w-[180px] max-h-[60vh] overflow-y-auto">
            {SUPPORTED_LOCALES.map((l) => (
              <button
                key={l.code}
                onClick={() => { setLocale(l.code); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-700 transition-colors ${
                  l.code === locale ? 'bg-emerald-900/30 text-emerald-400' : 'text-zinc-300'
                }`}
              >
                <span>{l.flag}</span>
                <span>{l.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
