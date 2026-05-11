-- Allow product_listings to be marked 'superseded' when a better-margin
-- version of the same AliExpress product replaces it in the store.
ALTER TABLE product_listings DROP CONSTRAINT IF EXISTS product_listings_status_check;
ALTER TABLE product_listings ADD CONSTRAINT product_listings_status_check
  CHECK (status IN (
    'pending_review',
    'approved',
    'rejected',
    'published',
    'duplicate',
    'error',
    'superseded'
  ));
