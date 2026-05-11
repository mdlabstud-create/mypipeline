-- Retail reference from Amazon discovery (Scrapingdog search). Used to cap store price vs AliExpress cost.
ALTER TABLE trending_products
  ADD COLUMN IF NOT EXISTS amazon_retail_usd NUMERIC(10, 2);

COMMENT ON COLUMN trending_products.amazon_retail_usd IS
  'Amazon listing price observed at scrape time (when API returns it). Arbitrage anchor vs supplier cost.';
