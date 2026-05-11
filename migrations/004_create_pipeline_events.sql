CREATE TABLE IF NOT EXISTS pipeline_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage       TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('ok', 'warn', 'error')),
  message     TEXT NOT NULL,
  product_id  UUID REFERENCES trending_products(id),
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_events_stage
  ON pipeline_events(stage);

CREATE INDEX IF NOT EXISTS idx_pipeline_events_created_at
  ON pipeline_events(created_at DESC);