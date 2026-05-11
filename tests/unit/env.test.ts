import { describe, expect, it, vi } from 'vitest';

describe('env', () => {
  it('env.ts exits if DATABASE_URL is missing', async () => {
    vi.resetModules();
    const orig = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null) => {
        throw new Error(`exit:${typeof code === 'number' ? code : 0}`);
      });

    await expect(import('../../src/config/env')).rejects.toThrow(/exit:1/);

    exitSpy.mockRestore();
    if (orig !== undefined) process.env.DATABASE_URL = orig;
  });
});

