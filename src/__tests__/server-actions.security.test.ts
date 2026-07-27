import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, recordAuditMock, userUpdateMock, cookiesMock, cookieDeleteMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  recordAuditMock: vi.fn(),
  userUpdateMock: vi.fn(),
  cookiesMock: vi.fn(),
  cookieDeleteMock: vi.fn()
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { update: userUpdateMock } } }));
vi.mock('@/lib/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('next/headers', () => ({ cookies: cookiesMock }));

import { revokeAllSessionsAction } from '@/server-actions/security';

beforeEach(() => {
  vi.clearAllMocks();
  userUpdateMock.mockResolvedValue({ id: 'u1' });
  recordAuditMock.mockResolvedValue(undefined);
  cookiesMock.mockResolvedValue({ delete: cookieDeleteMock });
});

describe('revokeAllSessionsAction', () => {
  it('без сессии — forbidden и никаких мутаций', async () => {
    getSessionMock.mockResolvedValue(null);

    expect(await revokeAllSessionsAction()).toEqual({ ok: false, error: 'forbidden' });
    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
    expect(cookieDeleteMock).not.toHaveBeenCalled();
  });

  it('с сессией — инкремент sessionVersion своего пользователя', async () => {
    getSessionMock.mockResolvedValue({ sub: 'u1', role: 'partner' });

    expect(await revokeAllSessionsAction()).toEqual({ ok: true });
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { sessionVersion: { increment: 1 } }
    });
  });

  it('пишет аудит sessions_revoked по сущности user', async () => {
    getSessionMock.mockResolvedValue({ sub: 'u7', role: 'manager' });

    await revokeAllSessionsAction();

    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'u7',
        action: 'sessions_revoked',
        entity: 'user',
        entityId: 'u7'
      })
    );
  });

  it('удаляет собственную cookie session — текущее устройство тоже выходит', async () => {
    getSessionMock.mockResolvedValue({ sub: 'u1', role: 'organization' });

    await revokeAllSessionsAction();

    expect(cookieDeleteMock).toHaveBeenCalledWith('session');
  });

  it('сбой аудита проглатывается и не ломает результат', async () => {
    getSessionMock.mockResolvedValue({ sub: 'u1', role: 'admin' });
    recordAuditMock.mockRejectedValue(new Error('audit down'));

    expect(await revokeAllSessionsAction()).toEqual({ ok: true });
    expect(cookieDeleteMock).toHaveBeenCalledWith('session');
  });
});
