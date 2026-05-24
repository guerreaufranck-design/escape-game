-- Migration 039 : GPS tracking pendant les sessions de jeu
--
-- Contexte (2026-05-23) : suite à la plainte client Bibinouze sur Cuenca
-- ("le GPS nous a dirigés à l'opposé de la zone"), impossibilité de
-- vérifier sa version. Cette table stocke les positions GPS du joueur
-- pendant sa partie, pour :
--
--   1. Post-mortem litiges client : "tu as marché ici, le stop était là"
--   2. Détection bugs systémiques : "80% des joueurs abandonnent step 4"
--   3. Assistance live : admin voit la position courante et peut guider
--   4. Optimisation parcours : détecter les détours moyens, les zones
--      de confusion, les zones où l'AR ne se déclenche pas
--
-- Conformité RGPD :
--   - Lié uniquement au session_id (pas de nom/email)
--   - Cascade DELETE quand session supprimée
--   - Rétention 30 jours auto-purgée par cron
--   - Consentement donné via intro_speech briefing

CREATE TABLE IF NOT EXISTS gps_traces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,

  latitude      DOUBLE PRECISION NOT NULL,
  longitude     DOUBLE PRECISION NOT NULL,

  -- Métadonnées GPS retournées par le navigateur (peuvent être null
  -- selon le device et les permissions accordées).
  accuracy_m    REAL,            -- précision horizontale en mètres
  heading_deg   REAL,            -- cap (0-360°, 0=Nord), null à l'arrêt
  speed_mps     REAL,            -- vitesse en m/s

  -- Quel step du jeu était actif au moment de la capture. Permet de
  -- segmenter le tracé par step ("zone de confusion sur le step 4")
  -- sans devoir re-mapper a posteriori.
  step_order    INT,

  -- Timestamp de la capture côté CLIENT (le navigateur a déjà cette
  -- info via position.timestamp). On stocke en plus le received_at
  -- côté serveur pour détecter les batches retardés (mauvaise connexion).
  captured_at   TIMESTAMPTZ NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index principal : timeline d'une session pour visualisation
CREATE INDEX IF NOT EXISTS gps_traces_session_t_idx
  ON gps_traces(session_id, captured_at);

-- Index pour la purge cron 30j
CREATE INDEX IF NOT EXISTS gps_traces_received_at_idx
  ON gps_traces(received_at);

-- Pas de RLS pour l'instant — l'accès passe uniquement par les endpoints
-- API qui font leur propre auth (admin pour la lecture, sessionId valide
-- pour l'insertion).
