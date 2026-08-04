import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * После аудита A1 экшен — тонкий адаптер: гард сессии, вызов сервиса
 * `revokeAllSessions`, удаление собственной cookie. Работа с БД и аудитом
 * проверяется в services.auth.sessions.unit.test.ts.
 */

const { getSessionMock, revokeAllSessionsMock, cookiesMock, cookieDeleteMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  revokeAllSessionsMock: vi.fn(),
  cookiesMock: vi.fn(),
  cookieDeleteMock: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/services/auth/sessions', () => ({ revokeAllSessions: revokeAllSessionsMock }));
vi.mock('next/headers', () => ({ cookies: cookiesMock }));

import { revokeAllSessionsAction } from '@/server-actions/security';

beforeEach(() => {
  vi.clearAllMocks();
  revokeAllSessionsMock.mockResolvedValue({ ok: true });
  cookiesMock.mockResolvedValue({ delete: cookieDeleteMock });
});

describe('revokeAllSessionsAction', () => {
  it('без сессии — forbidden и никаких мутаций', async () => {
    getSessionMock.mockResolvedValue(null);

    expect(await revokeAllSessionsAction()).toEqual({ ok: false, error: 'forbidden' });
    expect(revokeAllSessionsMock).not.toHaveBeenCalled();
    expect(cookieDeleteMock).not.toHaveBeenCalled();
  });

  it('с сессией — отзыв идёт по своей сессии (id сервису не передаётся отдельно)', async () => {
    const session = { sub: 'u1', role: 'partner' };
    getSessionMock.mockResolvedValue(session);

    expect(await revokeAllSessionsAction()).toEqual({ ok: true });
    expect(revokeAllSessionsMock).toHaveBeenCalledWith(expect.anything(), session);
  });

  it('удаляет собственную cookie session — текущее устройство тоже выходит', async () => {
    getSessionMock.mockResolvedValue({ sub: 'u1', role: 'organization' });

    await revokeAllSessionsAction();

    expect(cookieDeleteMock).toHaveBeenCalledWith('session');
  });
});
