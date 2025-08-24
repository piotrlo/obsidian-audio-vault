import { describe, it, expect } from 'vitest';
import { checkQuotaLimit, logEvent } from './queries';

function dbStub(){
  return {
    prepare: () => ({ bind: () => ({ first: async () => ({ chars_used: 0 }), run: async () => ({}) }) })
  } as any;
}

describe('db/queries helpers', () => {
  it('checkQuotaLimit computes remaining and allowed', async () => {
    const res = await checkQuotaLimit(dbStub(), 1, 'basic', 10, { free: 1, basic: 100, pro: 1000 } as any);
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBeGreaterThan(0);
  });

  it('logEvent writes without throwing', async () => {
    await logEvent(dbStub(), 1, 'test_event', { a: 1 });
    expect(true).toBe(true);
  });
});


