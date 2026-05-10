-- Migration : transport_mode + paramètres roadtrip
--
-- Ajoute le support des fiches "roadtrip" (driving / mixed) en parallèle
-- des walking tours historiques. Cf. contrat OddballTrip → escape-game
-- du 2026-05-10 (Franck). Tout est additif : les jeux walking actuels
-- conservent transport_mode='walking' (default) et radius_km/recommended_*
-- restent NULL.
--
-- Pourquoi ces champs sont sur `games` et pas dans une table séparée :
--   • Une fiche EST un mode de transport (pas une variante temporaire)
--   • Le contrat OddballTrip distingue 2 SLUGS différents par destination
--     (paimpont-walking + broceliande-driving) → chaque jeu est autonome
--   • Pas de table de jointure ni de quest_sites parents : chaque fiche
--     est un produit indépendant, traité identiquement par le pipeline,
--     seul le RAYON de discovery change

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS transport_mode TEXT NOT NULL DEFAULT 'walking'
    CHECK (transport_mode IN ('walking', 'driving', 'mixed'));

-- Rayon de discovery en km. NULL = défaut walking (1.5 km).
-- Pour driving / mixed : typiquement 30 km (contrat OddballTrip), peut
-- monter à 50 km pour roadtrips de plusieurs jours.
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS radius_km NUMERIC;

-- Durée recommandée du roadtrip (NULL pour walking, qui se joue en 90 min).
-- Le frontend affiche "Ce roadtrip se joue sur X à Y jours, à votre rythme."
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS recommended_days_min INTEGER;

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS recommended_days_max INTEGER;

-- Validité du code activation en HEURES après première activation.
-- Walking : 24h (existant, cf. migration 013).
-- Roadtrip 2-4 jours : (recommended_days_max + 7) * 24 = ~264h
-- Roadtrip 6 jours : (6 + 7) * 24 = 312h
-- Calculé côté pipeline lors de l'insert game et stocké ici pour que la
-- fonction activate_code Postgres puisse y accéder sans logique applicative.
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS code_validity_hours INTEGER NOT NULL DEFAULT 24;

-- Index sur transport_mode pour requêtes admin / dashboard
-- (filtrer "tous les roadtrips needs_review" par exemple).
CREATE INDEX IF NOT EXISTS idx_games_transport_mode
  ON public.games (transport_mode)
  WHERE transport_mode <> 'walking';

COMMENT ON COLUMN public.games.transport_mode IS
  'walking (default, 90 min à pied) | driving (100% voiture) | mixed (voiture + à pied par site)';
COMMENT ON COLUMN public.games.radius_km IS
  'Rayon de discovery autour du startPoint, en km. NULL = walking default 1.5km. Roadtrip typique 30-50km.';
COMMENT ON COLUMN public.games.recommended_days_min IS
  'Durée min recommandée pour parcourir le roadtrip, en jours. NULL pour walking.';
COMMENT ON COLUMN public.games.recommended_days_max IS
  'Durée max recommandée. NULL pour walking. Sert à calculer code_validity_hours.';
COMMENT ON COLUMN public.games.code_validity_hours IS
  'Validité du code activation en heures après 1ère activation. Walking 24h, roadtrip ~264h.';
