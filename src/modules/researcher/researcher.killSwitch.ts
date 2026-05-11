import redisClient from '../../config/redis';
import { env } from '../../config/env';
import { logPipelineEvent } from '../../shared/logger';

/**
 * Computes whether the researcher kill switch should trip and, if so, sets the Redis flag.
 */
export async function shouldTripResearcherKillSwitch(params: {
  total: number;
  failed: number;
  /**
   * When at least one supplier source succeeded, partial failures are expected
   * (CAPTCHA/timeouts per site) and must not disable the entire researcher lane.
   */
  fulfilledWithResults: boolean;
  backoffSeconds: number;
}): Promise<boolean> {
  const { total, failed, fulfilledWithResults, backoffSeconds } = params;
  if (env.DISABLE_RESEARCHER_KILL_SWITCH) return false;
  if (total <= 0) return false;

  if (fulfilledWithResults) return false;

  // Only trip when every configured source path rejected/threw for this product.
  if (failed < total) return false;

  const errorRate = failed / total;
  await redisClient.set('pipeline:researcher:enabled', '0', 'EX', backoffSeconds);
  await logPipelineEvent({
    stage: 'researcher',
    status: 'warn',
    message: 'researcher kill switch activated',
    payload: { errorRate, total, failed, fulfilledWithResults, backoffSeconds }
  });

  return true;
}
