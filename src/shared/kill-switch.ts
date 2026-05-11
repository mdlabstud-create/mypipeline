import redisClient from '../config/redis';
import { logPipelineEvent } from './logger';

export type KillSwitchModule =
  | 'tiktok'
  | 'amazon'
  | 'researcher'
  | 'content'
  | 'publisher'
  | 'all';

function isFalse(value: string | null): boolean {
  if (value === null) return false;
  return value === '0' || value.toLowerCase() === 'false';
}

/**
 * Checks whether the global/module kill switch is enabled.
 */
export async function isEnabled(module: KillSwitchModule): Promise<boolean> {
  const global = await redisClient.get('pipeline:enabled');
  if (isFalse(global)) return false;

  if (module === 'all') return true;
  const mod = await redisClient.get(`pipeline:${module}:enabled`);
  if (isFalse(mod)) return false;
  return true;
}

/**
 * Disables a module kill switch for a TTL window.
 */
export async function disable(module: KillSwitchModule, ttlSeconds: number): Promise<void> {
  const key = module === 'all' ? 'pipeline:enabled' : `pipeline:${module}:enabled`;
  await redisClient.set(key, '0', 'EX', ttlSeconds);
  await logPipelineEvent({
    stage: 'kill-switch',
    status: 'warn',
    message: `Kill switch activated for ${module}`,
    payload: { module, ttlSeconds }
  });
}

