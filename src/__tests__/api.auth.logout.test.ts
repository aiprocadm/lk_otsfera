import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionMock, endSessionOnLogoutMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  endSessionOnLogoutMock: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/services/auth/sessions', () => ({ endSessionOnLogout: endSessionOnLogoutMock }));

import { POST } from '@/app/api/auth/logout/route';

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue(null);
    endSessionOnLogoutMock.mockResolvedValue({ ok: true });
  });

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

  // `У-324` (ТЗ 28.10.2026): выход отзывает токен на сервере.
  it('при живой сессии отзывает токен (sessionVersion) — не только стирает cookie', async () => {
    const session = { sub: 'u1', role: 'organization' };
    getSessionMock.mockResolvedValue(session);

    await POST();

    expect(endSessionOnLogoutMock).toHaveBeenCalledWith(expect.anything(), session);
  });

  it('без сессии отзывать нечего — сервис не зовётся', async () => {
    await POST();
    expect(endSessionOnLogoutMock).not.toHaveBeenCalled();
  });

  it('сбой отзыва не мешает выйти: cookie всё равно стирается', async () => {
    getSessionMock.mockResolvedValue({ sub: 'u1', role: 'manager' });
    endSessionOnLogoutMock.mockRejectedValue(new Error('db down'));

    const res = await POST();

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
