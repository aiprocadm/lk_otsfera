import { describe, it, expect } from 'vitest';

import { POST } from '@/app/api/auth/logout/route';

describe('POST /api/auth/logout', () => {
  it('returns 200 with ok:true', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('sets the session cookie with maxAge=0 to clear it', async () => {
    const res = await POST();
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('session=');
    expect(setCookie).toContain('Max-Age=0');
  });

  it('sets httpOnly and SameSite=Lax on the cookie', async () => {
    const res = await POST();
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
  });

  it('sets the cookie path to /', async () => {
    const res = await POST();
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('Path=/');
  });
});
