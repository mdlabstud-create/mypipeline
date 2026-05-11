CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS trending_products (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword        TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('tiktok', 'amazon', 'both')),
  tiktok_score   NUMERIC(5,4),
  tiktok_views   BIGINT,
  tiktok_hashtag TEXT,
  amazon_asin    TEXT,
  amazon_bsr     INTEGER,
  amazon_score   NUMERIC(5,4),
  trend_score    NUMERIC(5,4) NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending_research'
                 CHECK (status IN (
                   'pending_research',
                   'researching',
                   'pending_content',
                   'generating',
                   'pending_review',
                   'approved',
                   'rejected',
                   'published',
                   'duplicate',
                   'error'
                 )),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trending_products_status
  ON trending_products(status);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_trending_products_keyword
  ON trending_products(keyword);

CREATE INDEX IF NOT EXISTS idx_trending_products_trend_score
  ON trending_products(trend_score DESC);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_trending_products_updated_at ON trending_products;
CREATE TRIGGER update_trending_products_updated_at
  BEFORE UPDATE ON trending_products
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();