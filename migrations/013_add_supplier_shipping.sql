ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS shipping_days_min   INTEGER       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS shipping_days_max   INTEGER       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS shipping_method     VARCHAR(100)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ships_from_country  VARCHAR(50)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sla_status          VARCHAR(20)   DEFAULT 'unknown'
    CHECK (sla_status IN ('unknown', 'fast', 'acceptable', 'slow', 'disqualified')),
  ADD COLUMN IF NOT EXISTS sla_checked_at      TIMESTAMPTZ   DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_sla_status
  ON suppliers(sla_status);
