import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import { query } from '../config/db';
import { env } from '../config/env';

type PipelineEventStatus = 'ok' | 'warn' | 'error';

const logsDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const fileName = `pipeline-${new Date().toISOString().slice(0, 10)}.log`;

/**
 * Project-wide structured logger.
 */
const logger = winston.createLogger({
  level: 'info',
  format:
    env.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp(),
          winston.format.printf(({ level, message, timestamp, ...meta }) => {
            const metaObj = meta as Record<string, unknown>;
            const rest =
              Object.keys(metaObj).length > 0 ? ` ${JSON.stringify(metaObj)}` : '';
            const ts = typeof timestamp === 'string' ? timestamp : '';
            const lvl = typeof level === 'string' ? level : String(level);
            const msg = typeof message === 'string' ? message : String(message);
            return `${ts} ${lvl}: ${msg}${rest}`;
          })
        ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(logsDir, fileName),
      format: winston.format.json()
    })
  ]
});

/**
 * Logs an event and persists it to the `pipeline_events` table.
 */
export async function logPipelineEvent(params: {
  stage: string;
  status: PipelineEventStatus;
  message: string;
  productId?: string;
  payload?: unknown;
}): Promise<void> {
  const { stage, status, message, productId, payload } = params;

  logger.log({
    level: status === 'error' ? 'error' : status === 'warn' ? 'warn' : 'info',
    message,
    stage,
    productId,
    payload
  });

  const sql =
    'INSERT INTO pipeline_events (stage, status, message, product_id, payload) VALUES ($1, $2, $3, $4, $5)';
  const payloadJson = payload === undefined ? null : JSON.stringify(payload);
  await query(sql, [stage, status, message, productId ?? null, payloadJson]);
}

export default logger;