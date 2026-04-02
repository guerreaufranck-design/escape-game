-- Migration: Create error_reports table for player feedback
-- Players can report riddle errors directly from the app

CREATE TABLE IF NOT EXISTS error_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  step_id UUID REFERENCES game_steps(id) ON DELETE CASCADE,
  session_id UUID REFERENCES game_sessions(id) ON DELETE SET NULL,
  player_name TEXT,
  step_order INT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'fixed', 'dismissed')),
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for admin dashboard queries
CREATE INDEX idx_error_reports_status ON error_reports(status, created_at DESC);
CREATE INDEX idx_error_reports_game ON error_reports(game_id);

-- RLS: anyone can insert (players), only admin can read/update
ALTER TABLE error_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can report errors"
  ON error_reports FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can view all reports"
  ON error_reports FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can update reports"
  ON error_reports FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );
