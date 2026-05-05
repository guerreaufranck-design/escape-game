-- Migration 022 — idempotency by orderId on activation codes.
--
-- Pourquoi : oddballtrip retry /api/external/generate-code en cas de
-- timeout HTTP (notre endpoint attendait la fin de prepareGamePackage,
-- 30-60 sec, ce qui dépassait le timeout fetch oddballtrip → retry →
-- nouveau code créé à chaque retry, jusqu'à 5 codes orphelins par
-- achat sur le test Rouen).
--
-- Fix : on ajoute une colonne `order_id` indexée. À chaque appel,
-- /api/external/generate-code check d'abord si un code existe pour
-- ce (game_id, order_id) — si oui, renvoie le code existant
-- (idempotent), pas de nouveau code, pas de pollution DB.
--
-- Le order_id reste optionnel (rétrocompat des anciens callers) :
-- quand absent, comportement legacy = nouveau code à chaque appel.

ALTER TABLE public.activation_codes
  ADD COLUMN IF NOT EXISTS order_id TEXT;

-- Index composite pour la lookup (game_id, order_id) — la clé fonctionnelle
-- de l'idempotence. PARTIAL pour ne pas indexer les rows sans order_id
-- (dataset existant en majorité), économise l'espace.
CREATE INDEX IF NOT EXISTS idx_activation_codes_game_order
  ON public.activation_codes (game_id, order_id)
  WHERE order_id IS NOT NULL;
