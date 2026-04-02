import { NextRequest, NextResponse } from "next/server";
import { isStaticLocale, detectLocale } from "@/lib/i18n";
import { ui } from "@/lib/translations";
import { translateUIStrings } from "@/lib/translate-service";

/**
 * GET /api/translations?lang=zh
 * Returns all UI strings translated to the requested locale.
 * For static locales (fr/en/de/es/it), returns from static file.
 * For others, uses Gemini + cache.
 */
export async function GET(request: NextRequest) {
  const locale = detectLocale(request);

  // For static locales, return from the translations file directly
  if (isStaticLocale(locale)) {
    const strings: Record<string, string> = {};
    for (const [key, translations] of Object.entries(ui)) {
      strings[key] = translations[locale] || translations.en || translations.fr || key;
    }
    return NextResponse.json({ locale, strings });
  }

  // For non-static locales, get English strings and translate via Gemini
  const englishStrings: Record<string, string> = {};
  for (const [key, translations] of Object.entries(ui)) {
    englishStrings[key] = translations.en || translations.fr || key;
  }

  const translated = await translateUIStrings(englishStrings, locale);

  return NextResponse.json({ locale, strings: translated });
}
