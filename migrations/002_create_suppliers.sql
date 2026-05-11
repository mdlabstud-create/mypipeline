CREATE TABLE IF NOT EXISTS suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES trending_products(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL CHECK (platform IN ('aliexpress', 'alibaba', '1688')),
  supplier_url    TEXT NOT NULL,
  product_title   TEXT,
  price_usd       NUMERIC(10,2) NOT NULL,
  price_cny       NUMERIC(10,2),
  moq             INTEGER NOT NULL DEFAULT 1,
  rating          NUMERIC(3,2),
  review_count    INTEGER DEFAULT 0,
  shipping_days   INTEGER,
  fast_ship       BOOLEAN DEFAULT false,
  supplier_score  NUMERIC(5,4),
  images          JSONB DEFAULT '[]',
  vetted          BOOLEAN DEFAULT false,
  rank            INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_product_id
  ON suppliers(product_id);

CREATE INDEX IF NOT EXISTS idx_suppliers_score
  ON suppliers(supplier_score DESC);