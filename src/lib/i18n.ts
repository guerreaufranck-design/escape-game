// Locale is now any 2-letter language code (ISO 639-1)
export type Locale = string;

// Pre-translated languages (UI strings available statically)
export const STATIC_LOCALES = ['fr', 'en', 'de', 'es', 'it'] as const;
export type StaticLocale = typeof STATIC_LOCALES[number];

// All languages shown in the selector
// `search` contains aliases for the search bar (English names, common spellings)
export const SUPPORTED_LOCALES: { code: string; label: string; flag: string; search: string }[] = [
  { code: 'fr', label: 'Francais', flag: '\u{1F1EB}\u{1F1F7}', search: 'french francais france' },
  { code: 'en', label: 'English', flag: '\u{1F1EC}\u{1F1E7}', search: 'english anglais' },
  { code: 'de', label: 'Deutsch', flag: '\u{1F1E9}\u{1F1EA}', search: 'german deutsch allemand' },
  { code: 'es', label: 'Espanol', flag: '\u{1F1EA}\u{1F1F8}', search: 'spanish espanol espagnol' },
  { code: 'it', label: 'Italiano', flag: '\u{1F1EE}\u{1F1F9}', search: 'italian italiano italien' },
  { code: 'pt', label: 'Portugues', flag: '\u{1F1F5}\u{1F1F9}', search: 'portuguese portugues portugais' },
  { code: 'nl', label: 'Nederlands', flag: '\u{1F1F3}\u{1F1F1}', search: 'dutch nederlands neerlandais' },
  { code: 'pl', label: 'Polski', flag: '\u{1F1F5}\u{1F1F1}', search: 'polish polski polonais' },
  { code: 'ru', label: 'Russkij', flag: '\u{1F1F7}\u{1F1FA}', search: 'russian russe russkij' },
  { code: 'zh', label: 'Zhongwen', flag: '\u{1F1E8}\u{1F1F3}', search: 'chinese chinois zhongwen mandarin' },
  { code: 'ja', label: 'Nihongo', flag: '\u{1F1EF}\u{1F1F5}', search: 'japanese japonais nihongo' },
  { code: 'ko', label: 'Hangugeo', flag: '\u{1F1F0}\u{1F1F7}', search: 'korean coreen hangugeo' },
  { code: 'ar', label: 'Arabiya', flag: '\u{1F1F8}\u{1F1E6}', search: 'arabic arabe arabiya' },
  { code: 'hi', label: 'Hindi', flag: '\u{1F1EE}\u{1F1F3}', search: 'hindi indien indian' },
  { code: 'tr', label: 'Turkce', flag: '\u{1F1F9}\u{1F1F7}', search: 'turkish turc turkce' },
  { code: 'sv', label: 'Svenska', flag: '\u{1F1F8}\u{1F1EA}', search: 'swedish suedois svenska' },
  { code: 'da', label: 'Dansk', flag: '\u{1F1E9}\u{1F1F0}', search: 'danish danois dansk' },
  { code: 'no', label: 'Norsk', flag: '\u{1F1F3}\u{1F1F4}', search: 'norwegian norvegien norsk' },
  { code: 'fi', label: 'Suomi', flag: '\u{1F1EB}\u{1F1EE}', search: 'finnish finnois suomi' },
  { code: 'el', label: 'Ellinika', flag: '\u{1F1EC}\u{1F1F7}', search: 'greek grec ellinika' },
  { code: 'cs', label: 'Cestina', flag: '\u{1F1E8}\u{1F1FF}', search: 'czech tcheque cestina' },
  { code: 'ro', label: 'Romana', flag: '\u{1F1F7}\u{1F1F4}', search: 'romanian roumain romana' },
  { code: 'hu', label: 'Magyar', flag: '\u{1F1ED}\u{1F1FA}', search: 'hungarian hongrois magyar' },
  { code: 'th', label: 'Thai', flag: '\u{1F1F9}\u{1F1ED}', search: 'thai thailandais' },
  { code: 'he', label: 'Ivrit', flag: '\u{1F1EE}\u{1F1F1}', search: 'hebrew hebreu ivrit' },
  { code: 'uk', label: 'Ukrainska', flag: '\u{1F1FA}\u{1F1E6}', search: 'ukrainian ukrainien ukrainska' },
  { code: 'id', label: 'Bahasa Indonesia', flag: '\u{1F1EE}\u{1F1E9}', search: 'indonesian indonesien bahasa' },
  { code: 'vi', label: 'Tieng Viet', flag: '\u{1F1FB}\u{1F1F3}', search: 'vietnamese vietnamien tieng viet' },
  { code: 'ms', label: 'Bahasa Melayu', flag: '\u{1F1F2}\u{1F1FE}', search: 'malay malais melayu' },
  { code: 'hr', label: 'Hrvatski', flag: '\u{1F1ED}\u{1F1F7}', search: 'croatian croate hrvatski' },
  { code: 'bg', label: 'Balgarski', flag: '\u{1F1E7}\u{1F1EC}', search: 'bulgarian bulgare balgarski' },
  { code: 'ca', label: 'Catala', flag: '\u{1F3F4}\u{E0065}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', search: 'catalan catala' },
];

export const DEFAULT_LOCALE = 'fr';

export type LocalizedString = Record<string, string> | string;

/**
 * Extract text in the requested locale with fallback chain.
 * Works with both legacy JSONB objects and plain English strings.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function t(value: LocalizedString | any | null | undefined, locale: Locale = 'en'): string {
  if (!value) return '';
  if (typeof value === 'string') {
    // Could be a JSON-stringified object like '{"fr":"...","en":"..."}'
    if (value.startsWith('{') && value.includes('"')) {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed[locale] || parsed.en || parsed.fr || Object.values(parsed)[0] || value;
        }
      } catch { /* not JSON, use as-is */ }
    }
    return value;
  }
  // JSONB object: try requested locale, then en (base), then fr, then first available
  return value[locale] || value.en || value.fr || Object.values(value)[0] || '';
}

/**
 * Extract hint text
 */
export function localizeHints(
  hints: Array<{ order: number; text: LocalizedString; image?: string }> | null,
  locale: Locale = 'en'
): Array<{ order: number; text: string; image?: string }> {
  if (!hints) return [];
  return hints.map((hint) => ({
    ...hint,
    text: t(hint.text, locale),
  }));
}

/**
 * Check if a locale has static UI translations
 */
export function isStaticLocale(locale: string): locale is StaticLocale {
  return (STATIC_LOCALES as readonly string[]).includes(locale);
}

/**
 * Get the language name for Gemini prompts
 */
export function getLanguageName(code: string): string {
  const names: Record<string, string> = {
    fr: 'French', en: 'English', de: 'German', es: 'Spanish', it: 'Italian',
    pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', ru: 'Russian', zh: 'Chinese (Simplified)',
    ja: 'Japanese', ko: 'Korean', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish',
    sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', el: 'Greek',
    cs: 'Czech', ro: 'Romanian', hu: 'Hungarian', th: 'Thai', he: 'Hebrew',
    uk: 'Ukrainian', id: 'Indonesian', vi: 'Vietnamese', ms: 'Malay',
    hr: 'Croatian', bg: 'Bulgarian', ca: 'Catalan',
  };
  return names[code] || code;
}

/**
 * Detect locale from query param or Accept-Language header.
 * Now accepts ANY 2-letter language code.
 */
export function detectLocale(request: Request): Locale {
  const url = new URL(request.url);
  const langParam = url.searchParams.get('lang');
  if (langParam && /^[a-z]{2}$/i.test(langParam)) {
    return langParam.toLowerCase();
  }

  const acceptLang = request.headers.get('accept-language');
  if (acceptLang) {
    const primary = acceptLang.split(',')[0]?.trim().slice(0, 2).toLowerCase();
    if (primary && /^[a-z]{2}$/.test(primary)) return primary;
  }

  return DEFAULT_LOCALE;
}
