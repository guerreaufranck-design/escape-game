"use client";

/**
 * Post-game upsell card — affiché APRÈS l'épilogue, AVANT le score.
 *
 * UX : le joueur vient de terminer son jeu, il est dans un état émotionnel
 * positif (révélation narrative + sensation d'accomplissement) → c'est
 * le moment psychologiquement le plus efficace pour suggérer la suite
 * de son séjour. On NE coupe PAS l'expérience pendant le jeu — un
 * upsell mid-tour distrairait et casserait l'immersion.
 *
 * Light-mode : le bouton ouvre la page de recherche GYG pour la ville
 * dans un nouvel onglet, avec le `partner_id` OddballTrip dans l'URL.
 * GYG pose un cookie 31j ; toute réservation pendant cette période
 * crédite OddballTrip (8% de commission par défaut).
 *
 * Si `NEXT_PUBLIC_GYG_PARTNER_ID` n'est pas configuré côté env, le
 * composant ne rend rien (`null`) — pas de fallback dégradé visible.
 */

import { Compass, ExternalLink, Sparkles } from "lucide-react";
import { buildGygSearchUrl } from "@/lib/gyg";

interface PostGameUpsellProps {
  /** Ville de l'aventure ("Cambridge", "Aegina") — utilisée pour la
   *  query de recherche GYG. Doit être en anglais ou nom international. */
  city: string;
  /** Localisation pour le texte du bouton (FR/EN/ES/...) — fallback EN
   *  si la langue n'est pas dans les traductions. */
  locale?: string;
}

const COPY: Record<string, { title: string; subtitle: string; cta: string; disclaimer: string }> = {
  en: {
    title: "Continue exploring",
    subtitle: "Discover guided tours, museums and unique experiences in {city} — picked from local operators.",
    cta: "Browse activities",
    disclaimer: "Powered by GetYourGuide · affiliated",
  },
  fr: {
    title: "Continuer l'exploration",
    subtitle: "Visites guidées, musées et expériences uniques à {city} — sélectionnés par des opérateurs locaux.",
    cta: "Voir les activités",
    disclaimer: "Via GetYourGuide · lien affilié",
  },
  es: {
    title: "Sigue explorando",
    subtitle: "Visitas guiadas, museos y experiencias únicas en {city}, seleccionadas por operadores locales.",
    cta: "Ver actividades",
    disclaimer: "Con GetYourGuide · enlace afiliado",
  },
  de: {
    title: "Weiter erkunden",
    subtitle: "Geführte Touren, Museen und einzigartige Erlebnisse in {city} — von lokalen Anbietern.",
    cta: "Aktivitäten ansehen",
    disclaimer: "Mit GetYourGuide · Affiliate-Link",
  },
  it: {
    title: "Continua a esplorare",
    subtitle: "Tour guidati, musei ed esperienze uniche a {city} — scelti da operatori locali.",
    cta: "Vedi attività",
    disclaimer: "Con GetYourGuide · link affiliato",
  },
  ja: {
    title: "もっと探検する",
    subtitle: "{city}のガイドツアー、博物館、ユニークな体験 — 現地のオペレーターから厳選。",
    cta: "アクティビティを見る",
    disclaimer: "提供：GetYourGuide · アフィリエイト",
  },
};

export function PostGameUpsell({ city, locale = "en" }: PostGameUpsellProps) {
  const url = buildGygSearchUrl(city, { placement: "post_game" });
  if (!url) return null; // partner_id absent → on n'affiche rien

  const copy = COPY[locale] ?? COPY.en;
  const subtitle = copy.subtitle.replace("{city}", city.split(",")[0]);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer sponsored"
      className="block rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/80 via-orange-950/60 to-slate-950/95 p-5 shadow-2xl transition hover:border-amber-400/60 hover:from-amber-900/80 hover:via-orange-900/60"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
          <Compass className="h-6 w-6 text-amber-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <h3 className="text-base font-bold text-amber-50">{copy.title}</h3>
          </div>
          <p className="text-sm text-amber-100/80 leading-relaxed mb-3">
            {subtitle}
          </p>
          <div className="inline-flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-amber-400">
            {copy.cta}
            <ExternalLink className="h-3.5 w-3.5" />
          </div>
        </div>
      </div>
      <p className="mt-3 text-right text-[9px] uppercase tracking-wider text-amber-200/40">
        {copy.disclaimer}
      </p>
    </a>
  );
}
