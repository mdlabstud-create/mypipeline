CREATE TABLE IF NOT EXISTS ad_creatives (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        UUID        NOT NULL REFERENCES product_listings(id) ON DELETE CASCADE,
  product_id        UUID        NOT NULL REFERENCES trending_products(id),
  angles            JSONB       NOT NULL DEFAULT '[]',
  hooks             JSONB       NOT NULL DEFAULT '[]',
  image_ad_prompts  JSONB       NOT NULL DEFAULT '[]',
  video_scripts     JSONB       NOT NULL DEFAULT '[]',
  hashtags          JSONB       NOT NULL DEFAULT '{}',
  platform_copies   JSONB       NOT NULL DEFAULT '{}',
  generated_at      TIMESTAMPTZ DEFAULT NOW(),
  status            VARCHAR(20) DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'used'))
);

CREATE INDEX IF NOT EXISTS idx_ad_creatives_listing_id ON ad_creatives(listing_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_product_id ON ad_creatives(product_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_status     ON ad_creatives(status);
