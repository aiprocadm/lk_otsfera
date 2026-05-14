import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('jose', () => ({ jwtVerify: vi.fn() }));

import { jwtVerify } from 'jose';
import { middleware } from '@/middleware';

function req(pathname: string, token?: string) {
  return {
    url: `https://app.local${pathname}`,
    nextUrl: { pathname },
    cookies: { get: vi.fn().mockReturnValue(token ? { value: token } : undefined) }
  } as any;
}

describe('auth middleware', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.JWT_SECRET = 'secret';
  });

  it('allows unauthenticated user to pass on /login and /reset-password', async () => {
    const loginRes = await middleware(req('/login'));
    expect(loginRes.status).toBe(200);
    expect(loginRes.type).toBe('default');
    expect(loginRes.headers.get('location')).toBeNull();
    expect(loginRes.url).toBe('');

    const resetRes = await middleware(req('/reset-password'));
    expect(resetRes.status).toBe(200);
    expect(resetRes.type).toBe('default');
    expect(resetRes.headers.get('location')).toBeNull();
    expect(resetRes.url).toBe('');
  });

  it('redirects authenticated user from /login to role home', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'partner' } } as any);

    const res = await middleware(req('/login', 'tkn'));

    expect(res.status).toBe(307);
    expect(res.type).toBe('default');
    expect(res.headers.get('location')).toBe('https://app.local/partner/dashboard');
    expect(res.url).toBe('');
  });

  it('redirects authenticated user from / and /dashboard to role home', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'organization' } } as any);

    const rootRes = await middleware(req('/', 'tkn'));
    expect(rootRes.status).toBe(307);
    expect(rootRes.type).toBe('default');
    expect(rootRes.headers.get('location')).toBe('https://app.local/organization/dashboard');
    expect(rootRes.url).toBe('');

    const dashboardRes = await middleware(req('/dashboard', 'tkn'));
    expect(dashboardRes.status).toBe(307);
    expect(dashboardRes.type).toBe('default');
    expect(dashboardRes.headers.get('location')).toBe('https://app.local/organization/dashboard');
    expect(dashboardRes.url).toBe('');
  });

  it('redirects forbidden role for protected prefix to /forbidden', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'organization' } } as any);

    const res = await middleware(req('/admin/orders', 'tkn'));

    expect(res.status).toBe(307);
    expect(res.type).toBe('default');
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
    expect(res.url).toBe('');
  });
});
