-- Order-forwarding state for the Shopify -> AliExpress dropship bridge.
-- One row per Shopify order we attempted to forward to AliExpress.
CREATE TABLE IF NOT EXISTS forwarded_orders (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Inbound (Shopify)
  shopify_order_id    TEXT        NOT NULL UNIQUE,
  shopify_order_name  TEXT,

  -- Outbound (AliExpress); null until placed.
  aliexpress_order_id TEXT,
  aliexpress_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,

  -- Status machine:
  --   pending          -> awaiting forwarder worker
  --   placed           -> AliExpress accepted; aliexpress_order_id populated
  --   dry_run          -> would-have-placed; no money moved (DROPSHIP_FORWARD_DRY_RUN=true)
  --   manual_review    -> couldn't auto-resolve (mixed suppliers, missing listing, etc.)
  --   error            -> AE call failed after retries
  status              TEXT        NOT NULL CHECK (status IN
                          ('pending','placed','dry_run','manual_review','error')),

  -- Diagnostics & idempotency
  request_payload     JSONB,
  response_payload    JSONB,
  error_message       TEXT,
  attempts            INTEGER     NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS forwarded_orders_status_idx
  ON forwarded_orders (status);

CREATE INDEX IF NOT EXISTS forwarded_orders_supplier_idx
  ON forwarded_orders (aliexpress_supplier_id);
