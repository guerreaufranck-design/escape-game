-- Migration 040 : AR events tracking pendant les sessions
--
-- Contexte (2026-05-23) : suite plainte Bibinouze Cuenca + besoin
-- d'objectiver les "l'AR n'a pas fonctionné". On enregistre chaque
-- événement clé du flow AR :
--
--   1. ar_open              — joueur a tapé "Mode AR"
--   2. ar_camera_ready      — camera stream démarré (permission OK)
--   3. ar_camera_denied     — permission caméra refusée
--   4. ar_compass_granted   — motion permission iOS accordée
--   5. ar_compass_denied    — motion permission iOS refusée
--   6. ar_lock_on           — distance < 50m AND (heading aligned OR no compass)
--   7. ar_facade_revealed   — le magic word s'affiche sur la façade
--   8. ar_character_speak   — personnage AR commence à parler
--   9. ar_auto_validated    — auto-validation après 1.5s de lock-on
--  10. ar_manual_validated  — joueur a tapé "Valider quand même"
--  11. ar_close             — joueur ferme le mode AR
--
-- Avec ces 11 événements + timestamps + step_order, on peut reconstituer
-- pour chaque session :
--   "Step 2 : a ouvert l'AR 3 fois, jamais lock-on, jamais auto-validé"
--   = signe clair que le GPS l'a empêché d'atteindre le rayon validation
--
-- Conformité RGPD : lié à session_id (pas de donnée perso). Auto-purge
-- 30 jours via le même cron que gps_traces.

CREATE TABLE IF NOT EXISTS ar_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,

  step_order    INT,
  event_type    TEXT NOT NULL,

  -- Métadonnées : distance au target, angle compass, lat/lon player,
  -- raison du denial, etc. Format libre JSONB.
  metadata      JSONB,

  captured_at   TIMESTAMPTZ NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ar_events_session_t_idx
  ON ar_events(session_id, captured_at);

CREATE INDEX IF NOT EXISTS ar_events_type_idx
  ON ar_events(event_type);

CREATE INDEX IF NOT EXISTS ar_events_received_at_idx
  ON ar_events(received_at);
