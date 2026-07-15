/**
 * WHITE-LABEL (2026-07-15) — la PWA player est partagée par plusieurs sites
 * revendeurs. On adapte le nom, le logo, l'e-mail de support et le texte de
 * partage au site qui a GÉNÉRÉ le code, détecté via le PRÉFIXE du slug du jeu :
 *   - slt-…  → Sur les traces (surlestraces.fr)
 *   - rsc-…  → Rumbo Secreto (rumbosecreto.es)
 *   - défaut → OddballTrip
 *
 * `Brand` est un objet sérialisable simple : il traverse le JSON de l'API
 * jusqu'au client sans traitement.
 */
export interface Brand {
  key: "oddballtrip" | "surlestraces" | "rumbosecreto";
  /** Nom affiché (partage, support, filigrane). */
  name: string;
  /** Chemin du logo dans /public. */
  logo: string;
  /** E-mail de support affiché au joueur. */
  supportEmail: string;
  /** Slug pour les noms de fichiers (selfie téléchargé). */
  fileSlug: string;
}

const BRANDS: Record<Brand["key"], Brand> = {
  oddballtrip: {
    key: "oddballtrip",
    name: "OddballTrip",
    logo: "/logo-oddballtrip.png",
    supportEmail: "support@oddballtrip.com",
    fileSlug: "oddballtrip",
  },
  surlestraces: {
    key: "surlestraces",
    name: "Sur les traces",
    logo: "/logo-surlestraces.png",
    supportEmail: "contact@surlestraces.fr",
    fileSlug: "surlestraces",
  },
  rumbosecreto: {
    key: "rumbosecreto",
    name: "Rumbo Secreto",
    logo: "/logo-rumbosecreto.png",
    supportEmail: "contact@rumbosecreto.es",
    fileSlug: "rumbosecreto",
  },
};

export const DEFAULT_BRAND: Brand = BRANDS.oddballtrip;

/** Détecte la marque à partir du slug du jeu (préfixe revendeur). */
export function brandFromSlug(slug?: string | null): Brand {
  const s = (slug || "").toLowerCase();
  if (s.startsWith("slt-")) return BRANDS.surlestraces;
  if (s.startsWith("rsc-")) return BRANDS.rumbosecreto;
  return BRANDS.oddballtrip;
}
