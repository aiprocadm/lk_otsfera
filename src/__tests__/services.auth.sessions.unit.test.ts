/**
 * Unit-тесты для src/lib/services/auth/sessions.ts.
 *
 * Мутация и аудит переехали сюда из server-action `revokeAllSessionsAction`
 * (аудит A1). Инвариант: отзыв всегда по `session.sub` — своего пользователя.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordAuditMock, userUpdateMock } = vi.hoisted(() => ({
  recordAuditMock: vi.fn(),
  userUpdateMock: vi.fn(),
}));

vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import { endSessionOnLogout, revokeAllSessions } from '@/lib/services/auth/sessions';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = { user: { update: userUpdateMock } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  userUpdateMock.mockResolvedValue({ id: 'u1' });
  recordAuditMock.mockResolvedValue(undefined);
});

describe('revokeAllSessions', () => {
  it('инкрементит sessionVersion своего пользователя', async () => {
    const session: SessionPayload = { sub: 'u1', role: 'partner' };

    expect(await revokeAllSessions(prisma, session)).toEqual({ ok: true });
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { sessionVersion: { increment: 1 } },
    });
  });

  it('пишет аудит sessions_revoked по сущности user', async () => {
    await revokeAllSessions(prisma, { sub: 'u7', role: 'manager' });

    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'u7',
        action: 'sessions_revoked',
        entity: 'user',
        entityId: 'u7',
      })
    );
  });

  it('сбой аудита проглатывается и не ломает результат', async () => {
    recordAuditMock.mockRejectedValue(new Error('audit down'));

    expect(await revokeAllSessions(prisma, { sub: 'u1', role: 'admin' })).toEqual({ ok: true });
  });
});

// `У-324` (ТЗ 28.10.2026, ДП §1 п. 5): выход отзывает токен — украденный до
// выхода токен после него не принимается `getSession` (версия разошлась).
describe('endSessionOnLogout', () => {
  it('инкрементит sessionVersion своего пользователя и пишет аудит logout', async () => {
    expect(await endSessionOnLogout(prisma, { sub: 'u3', role: 'student' })).toEqual({ ok: true });
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'u3' },
      data: { sessionVersion: { increment: 1 } },
    });
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'u3', action: 'logout', entity: 'user', entityId: 'u3' })
    );
  });
});
