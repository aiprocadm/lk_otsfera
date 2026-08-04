import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Этап 4 (ФТ-10.4): dismissWelcomeAction — зовёт сервис `markWelcomeSeen` и
 * ревалидирует свой дашборд. Только клиентские роли (organization/partner):
 * у staff-дашбордов welcome-блока нет, им и скрывать нечего.
 * Сама мутация проверяется в services.account.welcome.unit.test.ts.
 */

const { requireSession, revalidatePath, markWelcomeSeen } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  markWelcomeSeen: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/account/welcome', () => ({ markWelcomeSeen }));

import { dismissWelcomeAction } from '@/server-actions/welcome';

beforeEach(() => {
  vi.clearAllMocks();
  markWelcomeSeen.mockResolvedValue({ ok: true });
});

describe('dismissWelcomeAction — клиентские роли', () => {
  it('organization → markWelcomeSeen себе + revalidate /organization/dashboard', async () => {
    const session = { sub: 'org-user-1', role: 'organization' };
    requireSession.mockResolvedValue(session);

    const res = await dismissWelcomeAction();

    expect(res).toEqual({ ok: true });
    expect(markWelcomeSeen).toHaveBeenCalledTimes(1);
    expect(markWelcomeSeen).toHaveBeenCalledWith(expect.anything(), session);
    expect(revalidatePath).toHaveBeenCalledWith('/organization/dashboard');
  });

  it('partner → markWelcomeSeen себе + revalidate /partner/dashboard', async () => {
    const session = { sub: 'partner-user-1', role: 'partner', partnerId: 'pt-1' };
    requireSession.mockResolvedValue(session);

    const res = await dismissWelcomeAction();

    expect(res).toEqual({ ok: true });
    expect(markWelcomeSeen).toHaveBeenCalledWith(expect.anything(), session);
    expect(revalidatePath).toHaveBeenCalledWith('/partner/dashboard');
  });
});

describe('dismissWelcomeAction — staff-роли отсечены', () => {
  it.each(['manager', 'admin', 'student'] as const)(
    '%s → ok:false, сервис не вызван',
    async (role) => {
      requireSession.mockResolvedValue({ sub: 'staff-1', role });

      const res = await dismissWelcomeAction();

      expect(res).toEqual({ ok: false });
      expect(markWelcomeSeen).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );
});

describe('dismissWelcomeAction — сессия обязательна', () => {
  it('requireSession редиректит (throw) → сервис не вызывается', async () => {
    requireSession.mockRejectedValue(new Error('NEXT_REDIRECT'));

    await expect(dismissWelcomeAction()).rejects.toThrow('NEXT_REDIRECT');
    expect(markWelcomeSeen).not.toHaveBeenCalled();
  });
});
