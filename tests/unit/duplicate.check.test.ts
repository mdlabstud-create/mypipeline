import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db', () => {
  return { query: vi.fn(() => Promise.resolve([])) };
});

import { query } from '../../src/config/db';
import { checkDuplicate } from '../../src/modules/publisher/duplicate.check';

const q = query as unknown as ReturnType<typeof vi.fn>;

describe('duplicate.check', () => {
  it('returns true when same product already has a Shopify listing', async () => {
    q.mockImplementationOnce(() => Promise.resolve([{ id: 'other' }]));

    const isDup = await checkDuplicate('l1', 'Unique Title XYZ', [], 'p99');
    expect(isDup).toBe(true);
  });

  it('returns true when tags overlap > 60%', async () => {
    q.mockImplementationOnce(() => Promise.resolve([])); // no sibling Shopify
    q.mockImplementationOnce(() => Promise.resolve([])); // title exact match
    q.mockImplementationOnce(() =>
      Promise.resolve([
        { tags: ['a', 'b', 'c', 'd', 'e'] }
      ])
    );

    const isDup = await checkDuplicate('l1', 't', ['a', 'b', 'c', 'd', 'x'], 'pid');
    expect(isDup).toBe(true);
  });

  it('returns false when overlap small', async () => {
    q.mockImplementationOnce(() => Promise.resolve([]));
    q.mockImplementationOnce(() => Promise.resolve([]));
    q.mockImplementationOnce(() =>
      Promise.resolve([
        { tags: ['k', 'l'] }
      ])
    );

    const isDup = await checkDuplicate('l1', 't', ['a', 'b', 'c', 'd', 'x'], 'pid');
    expect(isDup).toBe(false);
  });
});
