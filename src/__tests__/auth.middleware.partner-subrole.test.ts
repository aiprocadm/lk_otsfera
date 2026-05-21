import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('jose', () => ({ jwtVerify: vi.fn() }));

import { jwtVerify } from 'jose';
import { middleware } from '@/middleware';

function req(pathname: string, token = 'tkn') {
  return {
    url: `https://app.local${pathname}`,
    nextUrl: { pathname },
    cookies: { get: vi.fn().mockReturnValue({ value: token }) }
  } as any;
}

describe('middleware partner sub-role', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.JWT_SECRET = 'middleware-sub-test-secret-with-at-least-32-chars';
  });

  it('redirects partner manager away from /partner/team to /forbidden', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'partner', partnerRole: 'manager', assignedOrgIds: [] }
    } as any);

    const res = await middleware(req('/partner/team'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });

  it('allows partner admin on /partner/team', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'partner', partnerRole: 'admin', assignedOrgIds: [] }
    } as any);

    const res = await middleware(req('/partner/team'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects manager from /partner/portfolio/abc/settings to /forbidden', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'partner', partnerRole: 'manager', assignedOrgIds: ['abc'] }
    } as any);

    const res = await middleware(req('/partner/portfolio/abc/settings'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });

  it('allows manager on /partner/portfolio/abc (without /settings suffix)', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'partner', partnerRole: 'manager', assignedOrgIds: ['abc'] }
    } as any);

    const res = await middleware(req('/partner/portfolio/abc'));

    expect(res.status).toBe(200);
  });

  it('does not apply sub-role check to non-partner roles', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'admin' }
    } as any);

    const res = await middleware(req('/partner/team'));

    expect(res.status).toBe(200);
  });

  it('treats partner without partnerRole (legacy) as non-admin (cannot access /partner/team)', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'partner', partnerId: 'p1' }
    } as any);

    const res = await middleware(req('/partner/team'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });
});
