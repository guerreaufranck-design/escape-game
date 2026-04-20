-- Add buyer_email to activation_codes for traceability
-- When a code generation fails, we need the email to contact the client
ALTER TABLE activation_codes ADD COLUMN IF NOT EXISTS buyer_email TEXT;

-- Index for lookup by buyer email (e.g., admin support)
CREATE INDEX IF NOT EXISTS idx_activation_codes_buyer_email
  ON activation_codes(buyer_email) WHERE buyer_email IS NOT NULL;
