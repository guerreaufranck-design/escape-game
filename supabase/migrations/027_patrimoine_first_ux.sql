-- Migration 027 — Patrimoine-first UX refactor (suite vision client 2026-05-16)
--
-- ═══════════════════════════════════════════════════════════════════════
-- CONTEXTE
-- ═══════════════════════════════════════════════════════════════════════
--
-- Le client (post-incident Julien Alba) a redéfini la promesse produit :
--
--   1. Découvrir la ville et son histoire (PRIORITÉ ABSOLUE)
--   2. Apprendre des choses concrètes sur chaque lieu
--   3. Le jeu thématique = fil rouge narratif, pas filtre de sélection
--   4. Vivre une expérience mémorable (intro guide + énigme finale + selfie)
--
-- Conséquences schéma :
--   - chaque stop porte une HISTOIRE DU LIEU (indépendante du thème) en plus
--     de l'anecdote thématique → 2 cards UI au lieu d'1
--   - le jeu démarre sur un DISCOURS D'INTRO du guide (avant stop 1)
--   - le jeu se termine sur une ÉNIGME FINALE combinant les indices, avec
--     2 essais, et un ÉPILOGUE CONDITIONNEL (succès/échec)
--   - les transitions entre stops peuvent mentionner des WAYPOINTS
--     intermédiaires (façade Art Déco au coin de la rue, fontaine, etc.)
--
-- Tous les champs sont NULLABLE pour rétrocompat avec les jeux existants.
-- La pipeline les remplit pour les nouveaux jeux + régénérations.
--
-- ═══════════════════════════════════════════════════════════════════════
-- CHANGEMENTS
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. Table `games` — nouveau bloc intro + énigme finale
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE games
  -- Discours du guide AVANT le stop 1. Multilingue JSONB {en, fr, ...}.
  -- Inclut : présentation, durée 1h30-3h30, code valable 7 jours, batterie/AR,
  -- philosophie "tous les lieux ne sont pas thématiques mais tous valent la
  -- visite", call-to-action "appuyez sur commencer".
  ADD COLUMN IF NOT EXISTS intro_speech JSONB,

  -- Énigme finale jouée après le dernier stop. Le joueur doit composer
  -- une phrase/un mot/un code qui combine les `answer_text` de chaque
  -- stop (= les indices). Multilingue JSONB.
  ADD COLUMN IF NOT EXISTS final_riddle_text JSONB,

  -- Réponse attendue à l'énigme finale. STRING libre (pas multilingue —
  -- l'énigme est conçue pour avoir la même réponse dans toutes les
  -- langues, ex: un mot latin, un chiffre, un nom propre). Comparaison
  -- fuzzy côté endpoint (case-insensitive, accent-insensitive, trim).
  ADD COLUMN IF NOT EXISTS final_answer TEXT,

  -- Explication "voilà pourquoi" affichée APRÈS la réponse (succès OU
  -- échec après 2 essais). Multilingue JSONB.
  ADD COLUMN IF NOT EXISTS final_answer_explanation JSONB;

COMMENT ON COLUMN games.intro_speech IS
  '🎙️ Discours du guide avant stop 1 — pose le ton et explique le format. Multilingue.';
COMMENT ON COLUMN games.final_riddle_text IS
  '🧩 Énigme finale combinant les indices des stops. Affichée après le dernier stop. Multilingue.';
COMMENT ON COLUMN games.final_answer IS
  '🔑 Réponse attendue (string libre, fuzzy match côté endpoint). Pas multilingue par construction.';
COMMENT ON COLUMN games.final_answer_explanation IS
  '📖 "Voilà pourquoi" — joué après succès ou après 2 échecs. Multilingue.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Table `game_steps` — histoire du lieu + waypoints intermédiaires
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE game_steps
  -- Histoire COMPLÈTE du lieu indépendamment du thème : qui l'a
  -- construit, quand, pourquoi, son rôle dans la ville. C'est ce qui
  -- transforme la marche en visite culturelle. Multilingue JSONB.
  -- Affichée APRÈS la trouvaille AR, AVANT l'anecdote thématique.
  ADD COLUMN IF NOT EXISTS landmark_history JSONB,

  -- Catégorie du POI posée par la discovery (patrimonial_landmark,
  -- thematic_anchor, micro_memorial). Utile pour l'audit admin et
  -- pour adapter le ton de la narration ("ici tomba X le DD/MM/YYYY"
  -- vs "construit au XIVe siècle par...").
  ADD COLUMN IF NOT EXISTS poi_category TEXT
    CHECK (poi_category IN ('patrimonial_landmark', 'thematic_anchor', 'micro_memorial')),

  -- Citation source de l'histoire du lieu (URL ou ref courte).
  ADD COLUMN IF NOT EXISTS landmark_citation TEXT,

  -- Waypoints intermédiaires à mentionner SUR LE CHEMIN vers ce stop
  -- ("en chemin vous allez passer devant la fontaine X et la façade Y").
  -- Tableau JSONB de {name, lat, lon, oneliner}. Joué par le guide
  -- pendant la transition narrative du stop N-1 vers le stop N.
  ADD COLUMN IF NOT EXISTS transition_waypoints JSONB DEFAULT '[]'::JSONB;

COMMENT ON COLUMN game_steps.landmark_history IS
  '🏛️ Histoire complète du lieu (indépendante du thème). 2-3 paragraphes. Affichée après la trouvaille AR. Multilingue.';
COMMENT ON COLUMN game_steps.poi_category IS
  'Catégorie discovery : patrimonial_landmark / thematic_anchor / micro_memorial.';
COMMENT ON COLUMN game_steps.landmark_citation IS
  'Source URL ou ref courte pour landmark_history (audit + crédibilité).';
COMMENT ON COLUMN game_steps.transition_waypoints IS
  '📍 Waypoints sur le chemin vers ce stop. Joués par le guide en transition. Format: [{name, lat, lon, oneliner}].';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Table `game_sessions` — état de l'énigme finale
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE game_sessions
  -- Compteur d'essais sur l'énigme finale (0, 1, ou 2). Au 2e essai
  -- raté on bascule sur l'épilogue d'échec.
  ADD COLUMN IF NOT EXISTS final_attempts_used SMALLINT NOT NULL DEFAULT 0
    CHECK (final_attempts_used BETWEEN 0 AND 2),

  -- TRUE = bonne réponse trouvée. FALSE = 2 essais ratés. NULL = pas
  -- encore tenté (le joueur n'a pas encore atteint l'énigme finale).
  ADD COLUMN IF NOT EXISTS final_succeeded BOOLEAN,

  -- Timestamp de la résolution (succès ou échec définitif).
  ADD COLUMN IF NOT EXISTS final_resolved_at TIMESTAMPTZ;

COMMENT ON COLUMN game_sessions.final_attempts_used IS
  'Nombre d''essais consommés sur l''énigme finale (max 2).';
COMMENT ON COLUMN game_sessions.final_succeeded IS
  'TRUE=succès, FALSE=2 échecs (épilogue echec), NULL=pas encore tenté.';
COMMENT ON COLUMN game_sessions.final_resolved_at IS
  'Timestamp de la résolution finale (succès ou échec).';

-- ─────────────────────────────────────────────────────────────────────
-- 4. Table `audio_cache` — étendre les slots pour les nouveaux blocs
-- ─────────────────────────────────────────────────────────────────────
-- Le CHECK constraint actuel autorise : character, anecdote, epilogue, riddle.
-- On ajoute : landmark_history, intro_speech, final_riddle, final_explanation.
-- Le step_order utilise 0 pour les slots "game-wide" (intro, final).

ALTER TABLE audio_cache
  DROP CONSTRAINT IF EXISTS audio_cache_slot_check;

ALTER TABLE audio_cache
  ADD CONSTRAINT audio_cache_slot_check
  CHECK (slot IN (
    'character',
    'anecdote',
    'epilogue',
    'riddle',
    'landmark_history',
    'intro_speech',
    'final_riddle',
    'final_explanation'
  ));

COMMENT ON CONSTRAINT audio_cache_slot_check ON audio_cache IS
  'Slots audio valides. Ajoutés en 2026-05-16 (vision client) : landmark_history (par stop), intro_speech (avant stop 1, step_order=0), final_riddle (énigme finale, step_order=0), final_explanation (épilogue conditionnel, step_order=0).';
