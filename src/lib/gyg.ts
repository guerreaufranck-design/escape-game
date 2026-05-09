/**
 * GetYourGuide affiliate link builder.
 *
 * Light-mode integration : on n'appelle PAS l'API GYG (qui demande un
 * partenariat validé + clé secret). On construit juste les URLs de
 * recherche avec le `partner_id` dans les paramètres — quand le joueur
 * clique, GYG pose un cookie d'affiliation qui crédite OddballTrip
 * pour toute réservation faite dans les 31 jours suivants.
 *
 * Comment l'opérateur s'inscrit :
 *   1. https://partner.getyourguide.com/ (compte affilié, gratuit)
 *   2. Récupère le partner_id (ex: VH0M8VQ)
 *   3. Renseigne `NEXT_PUBLIC_GYG_PARTNER_ID` dans les vars Vercel
 *   4. Tous les liens sortants posent automatiquement le cookie
 *
 * Commission GYG (mai 2026) : 8% par réservation. Conversion typique
 * post-jeu : 5-10% des joueurs cliquent, 1-2% bookent → ~$1-3 / jeu vendu
 * en revenu additionnel passif.
 */

/**
 * Construit une URL de recherche GYG affilée. Le joueur atterrit sur
 * la page de résultats GYG pour la ville donnée, et tout booking dans
 * les 31j suivants crédite l'affilié.
 *
 * @param city Nom de la ville ou destination ("Cambridge", "Aegina, Greece")
 * @param opts Options : partner_id (override), placement (analytics tag)
 */
export function buildGygSearchUrl(
  city: string,
  opts: {
    /** Partner ID GYG. Si absent, lit `NEXT_PUBLIC_GYG_PARTNER_ID` env. */
    partnerId?: string;
    /** Placement tag pour analytics ("post_game", "intro", "mid_tour"). */
    placement?: string;
    /** Code campagne — utile pour A/B test ou tracking par ville. */
    cmp?: string;
  } = {},
): string | null {
  const partnerId = opts.partnerId ?? process.env.NEXT_PUBLIC_GYG_PARTNER_ID;
  if (!partnerId) {
    return null; // Pas de partner_id configuré → bouton caché
  }
  // GYG s'attend à une query simple : nom de ville suffit pour
  // déclencher le matching de leur catalogue. On strip la fin
  // type ", Greece" qui parfois embrouille leur search engine.
  const cleanCity = city.split(",")[0].trim();
  const url = new URL("https://www.getyourguide.com/s/");
  url.searchParams.set("q", cleanCity);
  url.searchParams.set("partner_id", partnerId);
  if (opts.placement) url.searchParams.set("placement", opts.placement);
  if (opts.cmp) url.searchParams.set("cmp", opts.cmp);
  return url.toString();
}

/**
 * Détecte si l'intégration GYG est active. Affiche/cache le bouton
 * upsell selon que le partner_id est configuré côté env.
 */
export function isGygEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GYG_PARTNER_ID);
}
