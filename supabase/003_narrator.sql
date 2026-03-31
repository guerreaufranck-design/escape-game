-- ============================================
-- Migration 003 : Champs narrateur sur games
-- ============================================

-- Ajout des champs narrateur sur la table games
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS narrator_name TEXT,
  ADD COLUMN IF NOT EXISTS narrator_role TEXT,
  ADD COLUMN IF NOT EXISTS narrator_intro TEXT,
  ADD COLUMN IF NOT EXISTS narrator_avatar TEXT;

-- narrator_name  : nom du personnage narrateur (ex: "Guilhem de Minerve")
-- narrator_role  : son rôle/lien avec le lieu (ex: "Dernier évêque cathare de Carcassonne, 1209")
-- narrator_intro : texte d'introduction lu à voix haute au lancement du jeu
-- narrator_avatar: URL ou emoji représentant le personnage (optionnel)
