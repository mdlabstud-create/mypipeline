#!/bin/sh
# Polls Postgres for aliexpress_session_key. Once stored, runs the 3-product
# AliExpress test batch end-to-end. Logs to /app/aliexpress-watch.log.
LOG=/app/aliexpress-watch.log
echo "[$(date -Iseconds)] watcher starting" > "$LOG"
DEADLINE=$(( $(date +%s) + 60*60 ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  HAS=$(PGPASSWORD=dropship psql -h postgres -U dropship -d dropship -tAc \
    "SELECT 1 FROM pipeline_config WHERE key='aliexpress_session_key' AND length(coalesce(value,''))>10;" 2>/dev/null)
  if [ "$HAS" = "1" ]; then
    echo "[$(date -Iseconds)] session key detected, running test:aliexpress" >> "$LOG"
    npm run --silent test:aliexpress >> "$LOG" 2>&1
    echo "[$(date -Iseconds)] test:aliexpress finished (exit=$?)" >> "$LOG"
    exit 0
  fi
  sleep 15
done
echo "[$(date -Iseconds)] watcher timed out waiting for session key" >> "$LOG"
