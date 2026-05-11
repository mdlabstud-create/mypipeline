DO $$
BEGIN
  -- Default constraint name when created inline is usually suppliers_platform_check.
  -- Drop and recreate to include the Amazon fallback platform.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'suppliers_platform_check'
  ) THEN
    ALTER TABLE suppliers DROP CONSTRAINT suppliers_platform_check;
  END IF;
END $$;

ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_platform_check
  CHECK (platform IN ('aliexpress', 'alibaba', '1688', 'amazon'));

