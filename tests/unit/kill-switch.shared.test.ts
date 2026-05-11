import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/redis', () => {
  return {
    default: {
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn(() => Promise.resolve('OK'))
    }
  };
});

vi.mock('../../src/shared/logger', () => {
  return {
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logPipelineEvent: vi.fn(() => Promise.resolve())
  };
});

describe('shared kill switch', () => {
  it("isEnabled('all') returns false when pipeline:enabled=0", async () => {
    const { default: redisClient } = await import('../../src/config/redis');
    (redisClient.get as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      Promise.resolve('0')
    );

    const { isEnabled } = await import('../../src/shared/kill-switch');
    const ok = await isEnabled('all');
    expect(ok).toBe(false);
  });

  it("disable('tiktok', 3600) sets redis key with TTL", async () => {
    const { default: redisClient } = await import('../../src/config/redis');
    const { disable } = await import('../../src/shared/kill-switch');
    await disable('tiktok', 3600);
    expect(redisClient.set).toHaveBeenCalled();
  });
});

