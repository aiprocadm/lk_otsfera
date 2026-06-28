import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/health/live/route';

describe('GET /api/health/live', () => {
  it('returns 200 { status: ok } with no dependencies', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
