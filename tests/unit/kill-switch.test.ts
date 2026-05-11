import { describe, expect, it, vi } from 'vitest';
import redisClient from '../../src/config/redis';

vi.mock('../../src/config/db', () => {
  return {
    query: vi.fn(() => Promise.resolve([]))
  };
});

describe('researcher kill switch', () => {
  it('does not trip on partial failures if any supplier candidates were gathered', async () => {
    const getSpy = vi.spyOn(redisClient, 'get').mockResolvedValue('true');
    const setSpy = vi.spyOn(redisClient, 'set').mockResolvedValue('OK');

    const { shouldTripResearcherKillSwitch } = await import(
      '../../src/modules/researcher/researcher.killSwitch'
    );

    const tripped = await shouldTripResearcherKillSwitch({
      total: 3,
      failed: 2,
      fulfilledWithResults: true,
      backoffSeconds: 1800
    });

    expect(tripped).toBe(false);
    expect(setSpy).not.toHaveBeenCalled();

    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  it('does not trip when some sources still succeed (Promise fulfilled)', async () => {
    const getSpy = vi.spyOn(redisClient, 'get').mockResolvedValue('true');
    const setSpy = vi.spyOn(redisClient, 'set').mockResolvedValue('OK');

    const { shouldTripResearcherKillSwitch } = await import(
      '../../src/modules/researcher/researcher.killSwitch'
    );

    const tripped = await shouldTripResearcherKillSwitch({
      total: 3,
      failed: 2,
      fulfilledWithResults: false,
      backoffSeconds: 1800
    });

    expect(tripped).toBe(false);
    expect(setSpy).not.toHaveBeenCalled();

    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  it('trips when every source rejects and no candidates were gathered', async () => {
    const getSpy = vi.spyOn(redisClient, 'get').mockResolvedValue('true');
    const setSpy = vi.spyOn(redisClient, 'set').mockResolvedValue('OK');

    const { shouldTripResearcherKillSwitch } = await import(
      '../../src/modules/researcher/researcher.killSwitch'
    );

    const tripped = await shouldTripResearcherKillSwitch({
      total: 3,
      failed: 3,
      fulfilledWithResults: false,
      backoffSeconds: 1800
    });

    expect(tripped).toBe(true);
    expect(setSpy).toHaveBeenCalled();

    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});

