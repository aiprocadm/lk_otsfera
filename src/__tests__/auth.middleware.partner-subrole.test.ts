import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('jose', () => ({ jwtVerify: vi.fn() }));

import { jwtVerify } from 'jose';
import { middleware } from '@/middleware';

function req(pathname: string, token = 'tkn') {
  return {
    url: `https://app.local${pathname}`,
    nextUrl: { pathname, protocol: 'https:' },
    headers: new Headers(),
    cookies: { get: vi.fn().mockReturnValue({ value: token }) },
  } as any;
}

describe('middleware partner sub-role', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.JWT_SECRET = 'middleware-sub-test-secret-with-at-least-32-chars';
  });

  it('удалённый /partner/team middleware больше не охраняет — дальше его встретит 404 (У-263)', async () => {
    // Адрес был шлюзом во вкладку «Команда» настроек и удалён (прогон
    // сопровождения №37). Отбивать участника в /forbidden с несуществующей
    // страницы незачем: Next ответит «раздел переехал» любому.
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'partner', partnerRole: 'manager', assignedOrgIds: [] },
    } as any);

    const res = await middleware(req('/partner/team'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('allows partner admin on /partner/portfolio/abc/settings', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'partner', partnerRole: 'admin', assignedOrgIds: [] },
    } as any);

    const res = await middleware(req('/partner/portfolio/abc/settings'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects manager from /partner/portfolio/abc/settings to /forbidden', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'partner', partnerRole: 'manager', assignedOrgIds: ['abc'] },
    } as any);

    const res = await middleware(req('/partner/portfolio/abc/settings'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });

  it('allows manager on /partner/portfolio/abc (without /settings suffix)', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'partner', partnerRole: 'manager', assignedOrgIds: ['abc'] },
    } as any);

    const res = await middleware(req('/partner/portfolio/abc'));

    expect(res.status).toBe(200);
  });

  it('redirects non-partner roles (e.g. admin) away from /partner before the sub-role check (Model A — no dead door)', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'admin' },
    } as any);

    const res = await middleware(req('/partner/portfolio/abc/settings'));

    // Model A (ось 4 аудита): admin не входит в чужой кабинет — protectedPrefixes
    // отбивает его на /partner раньше, чем дойдёт до partner-sub-role проверки.
    // Admin-омнипотентность живёт в /admin/* + policy.ts, не в кабинетных префиксах.
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });

  it('treats partner without partnerRole (legacy) as non-admin (cannot access portfolio settings)', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'partner', partnerId: 'p1' },
    } as any);

    const res = await middleware(req('/partner/portfolio/abc/settings'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });
});
