-- Observed TikTok Shop / commerce price from hashtag scraper payloads or caption heuristic (USD).
ALTER TABLE trending_products
  ADD COLUMN IF NOT EXISTS tiktok_retail_usd NUMERIC(10, 2);

COMMENT ON COLUMN trending_products.tiktok_retail_usd IS
  'TikTok-affiliated retail in USD when Apify/item payload exposes a price, else caption "$X.XX" parse; scrape-time reference only.';
