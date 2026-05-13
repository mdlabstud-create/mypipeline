ALTER TABLE trending_products
  ADD COLUMN IF NOT EXISTS viability_score       NUMERIC(5,2)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS viability_breakdown   JSONB         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS viability_checked_at  TIMESTAMPTZ   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS viability_status      VARCHAR(20)   DEFAULT 'unchecked'
    CHECK (viability_status IN ('unchecked', 'viable', 'marginal', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_trending_viability_status
  ON trending_products(viability_status);
