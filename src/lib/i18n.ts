export type Locale = 'fr' | 'en' | 'de' | 'es' | 'it';

export const SUPPORTED_LOCALES: Locale[] = ['fr', 'en', 'de', 'es', 'it'];

export const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  it: 'Italiano',
};

export const DEFAULT_LOCALE: Locale = 'fr';

export type LocalizedString = Record<Locale, string> | string;

/**
 * Extract text in the requested locale with fallback chain: locale → fr → en → first available
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function t(value: LocalizedString | any | null | undefined, locale: Locale = 'fr'): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value[locale] || value.fr || value.en || Object.values(value)[0] || '';
}

/**
 * Extract hint text - hints have structure [{order, text: LocalizedString, image?}]
 */
export function localizeHints(
  hints: Array<{ order: number; text: LocalizedString; image?: string }> | null,
  locale: Locale = 'fr'
): Array<{ order: number; text: string; image?: string }> {
  if (!hints) return [];
  return hints.map((hint) => ({
    ...hint,
    text: t(hint.text, locale),
  }));
}

/**
 * Detect locale from Accept-Language header or query param
 */
export function detectLocale(request: Request): Locale {
  // Check ?lang= query param first
  const url = new URL(request.url);
  const langParam = url.searchParams.get('lang');
  if (langParam && SUPPORTED_LOCALES.includes(langParam as Locale)) {
    return langParam as Locale;
  }

  // Check Accept-Language header
  const acceptLang = request.headers.get('accept-language');
  if (acceptLang) {
    for (const locale of SUPPORTED_LOCALES) {
      if (acceptLang.toLowerCase().startsWith(locale)) return locale;
    }
    // Try partial match
    for (const locale of SUPPORTED_LOCALES) {
      if (acceptLang.toLowerCase().includes(locale)) return locale;
    }
  }

  return DEFAULT_LOCALE;
}
