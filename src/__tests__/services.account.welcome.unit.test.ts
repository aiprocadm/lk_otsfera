/**
 * Unit-тесты для src/lib/services/account/welcome.ts.
 *
 * Мутация переехала сюда из server-action `dismissWelcomeAction` (аудит A1).
 * Инвариант: обновляется строка `session.sub` — своего пользователя.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markWelcomeSeen } from '@/lib/services/account/welcome';
import type { SessionPayload } from '@/lib/auth/jwt';

const userUpdate = vi.fn();
const prisma = { user: { update: userUpdate } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  userUpdate.mockResolvedValue({});
});

describe('markWelcomeSeen', () => {
  it('ставит welcomeSeenAt своему пользователю', async () => {
    const session: SessionPayload = { sub: 'org-user-1', role: 'organization' };

    expect(await markWelcomeSeen(prisma, session)).toEqual({ ok: true });
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'org-user-1' },
      data: { welcomeSeenAt: expect.any(Date) },
    });
  });

  it('партнёру — тот же путь, id снова из сессии', async () => {
    await markWelcomeSeen(prisma, { sub: 'partner-user-1', role: 'partner', partnerId: 'pt-1' });

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'partner-user-1' },
      data: { welcomeSeenAt: expect.any(Date) },
    });
  });
});
