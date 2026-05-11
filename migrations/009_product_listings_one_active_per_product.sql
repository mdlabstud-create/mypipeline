-- One in-flight storefront listing per trending product:
-- avoids duplicate Shopify products when GPT churns titles or workers race.

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY product_id
           ORDER BY
             CASE status
               WHEN 'published' THEN 0
               WHEN 'approved' THEN 1
               WHEN 'pending_review' THEN 2
               ELSE 3
             END,
             published_at DESC NULLS LAST,
             CASE WHEN shopify_id IS NOT NULL THEN 0 ELSE 1 END,
             created_at ASC
         ) AS rn
    FROM product_listings
   WHERE status IN ('pending_review', 'approved', 'published')
)
UPDATE product_listings pl
SET status = 'duplicate',
    updated_at = now()
WHERE pl.id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS product_listings_one_active_status_per_product
  ON product_listings (product_id)
  WHERE status IN ('pending_review', 'approved', 'published');
