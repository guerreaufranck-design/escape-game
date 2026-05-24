-- Migration 041 : messages support admin ↔ joueur pendant une session
--
-- Permet à l'admin d'envoyer un message en temps réel au joueur depuis
-- /admin/sessions/[id] (ex : "tu es à 80m au Nord du Pont Vieux,
-- prends la rue à droite"). Le joueur voit le message en overlay dans
-- l'app via polling toutes les 15 sec.
--
-- V2 (préparé dès maintenant) : from_admin=false permet au joueur de
-- demander l'aide (bouton "Appeler le support") — pas activé en V1.
--
-- Conformité RGPD : lié à session_id pseudonymisé (pas de nom/email).
-- Auto-purge 30 jours par le cron quotidien.

CREATE TABLE IF NOT EXISTS support_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,

  -- true  = message admin → joueur (V1)
  -- false = message joueur → admin (V2)
  from_admin   BOOLEAN NOT NULL DEFAULT true,

  text         TEXT NOT NULL,

  -- Timestamp où le DESTINATAIRE a marqué le message comme lu.
  -- null = pas encore lu.
  read_at      TIMESTAMPTZ,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_messages_session_idx
  ON support_messages(session_id, created_at);

CREATE INDEX IF NOT EXISTS support_messages_unread_idx
  ON support_messages(session_id, read_at)
  WHERE read_at IS NULL;
