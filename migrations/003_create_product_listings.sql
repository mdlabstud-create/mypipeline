CREATE TABLE IF NOT EXISTS product_listings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES trending_products(id),
  supplier_id     UUID NOT NULL REFERENCES suppliers(id),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  bullet_points   JSONB DEFAULT '[]',
  tags            TEXT[] DEFAULT '{}',
  seo_title       TEXT,
  seo_description TEXT,
  images          JSONB DEFAULT '[]',
  cost_usd        NUMERIC(10,2) NOT NULL,
  retail_usd      NUMERIC(10,2) NOT NULL,
  margin_pct      NUMERIC(5,2) NOT NULL,
  shopify_id      TEXT,
  shopify_handle  TEXT,
  status          TEXT NOT NULL DEFAULT 'pending_review'
                  CHECK (status IN (
                    'pending_review',
                    'approved',
                    'rejected',
                    'published',
                    'duplicate',
                    'error'
                  )),
  review_notes    TEXT,
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_product_listings_updated_at ON product_listings;
CREATE TRIGGER update_product_listings_updated_at
  BEFORE UPDATE ON product_listings
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();