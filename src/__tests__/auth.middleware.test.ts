import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('jose', () => ({ jwtVerify: vi.fn() }));

import { jwtVerify } from 'jose';
import { middleware } from '@/middleware';

function req(pathname: string, token?: string) {
  return {
    url: `https://app.local${pathname}`,
    nextUrl: { pathname },
    cookies: { get: vi.fn().mockReturnValue(token ? { value: token } : undefined) },
  } as any;
}

describe('auth middleware', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.JWT_SECRET = 'middleware-test-secret-with-at-least-32-chars';
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

  it('redirects admin away from /partner (no dead door; admin works via /admin/*)', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'admin' } } as any);
    const res = await middleware(req('/partner/dashboard', 'tkn'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });

  it('redirects admin away from /organization (no dead door)', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'admin' } } as any);
    const res = await middleware(req('/organization/dashboard', 'tkn'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });

  it('still lets admin into its own /admin/* cabinet', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'admin' } } as any);
    const res = await middleware(req('/admin/orders', 'tkn'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects unauthenticated user on a protected path to /login', async () => {
    // no token, non-auth page → branch in getJwtSecret is not even reached;
    // the "if (!token)" arm that redirects to /login fires immediately.
    const res = await middleware(req('/partner/dashboard'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/login');
  });

  it('redirects to /login when JWT_SECRET is missing (getJwtSecret returns null)', async () => {
    // Arm: process.env.JWT_SECRET is undefined → jwtSecret is falsy → return null
    // → middleware: !secret → redirect /login
    delete process.env.JWT_SECRET;
    const res = await middleware(req('/partner/dashboard', 'tkn'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/login');
  });

  it('redirects to /login when JWT_SECRET is too short (< 32 chars)', async () => {
    // Arm: jwtSecret.length < MIN_JWT_SECRET_LENGTH → console.error + return null
    // → middleware: !secret → redirect /login
    process.env.JWT_SECRET = 'short';
    const res = await middleware(req('/partner/dashboard', 'tkn'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/login');
  });

  it('redirects to /login when jwtVerify throws (invalid/expired token)', async () => {
    // catch-block arm: jwtVerify rejects → redirect /login
    vi.mocked(jwtVerify).mockRejectedValue(new Error('invalid signature'));
    const res = await middleware(req('/partner/dashboard', 'tkn'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/login');
  });
});
