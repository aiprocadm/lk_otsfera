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

  it('redirects to role home after login for authenticated user', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'partner' } } as any);
    const res = await middleware(req('/login', 'tkn'));
    expect(res.headers.get('location')).toBe('https://app.local/partner/dashboard');
  });

  it('protects route guard and redirects unauthorized role to forbidden', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'organization' } } as any);
    const res = await middleware(req('/admin/orders', 'tkn'));
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });
});
