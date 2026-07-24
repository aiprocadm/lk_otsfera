import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Этап 4 (ФТ-10.4): dismissWelcomeAction — ставит себе welcomeSeenAt и
 * ревалидирует свой дашборд. Только клиентские роли (organization/partner):
 * у staff-дашбордов welcome-блока нет, им и скрывать нечего.
 */

const { requireSession, revalidatePath, userUpdate } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  userUpdate: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { update: userUpdate } } }));

import { dismissWelcomeAction } from '@/server-actions/welcome';

beforeEach(() => {
  vi.clearAllMocks();
  userUpdate.mockResolvedValue({});
});

describe('dismissWelcomeAction — клиентские роли', () => {
  it('organization → update welcomeSeenAt себе + revalidate /organization/dashboard', async () => {
    requireSession.mockResolvedValue({ sub: 'org-user-1', role: 'organization' });

    const res = await dismissWelcomeAction();

    expect(res).toEqual({ ok: true });
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'org-user-1' },
      data: { welcomeSeenAt: expect.any(Date) }
    });
    expect(revalidatePath).toHaveBeenCalledWith('/organization/dashboard');
  });

  it('partner → update welcomeSeenAt себе + revalidate /partner/dashboard', async () => {
    requireSession.mockResolvedValue({ sub: 'partner-user-1', role: 'partner', partnerId: 'pt-1' });

    const res = await dismissWelcomeAction();

    expect(res).toEqual({ ok: true });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'partner-user-1' },
      data: { welcomeSeenAt: expect.any(Date) }
    });
    expect(revalidatePath).toHaveBeenCalledWith('/partner/dashboard');
  });
});

describe('dismissWelcomeAction — staff-роли отсечены', () => {
  it.each(['manager', 'admin', 'student'] as const)('%s → ok:false, update не вызван', async (role) => {
    requireSession.mockResolvedValue({ sub: 'staff-1', role });

    const res = await dismissWelcomeAction();

    expect(res).toEqual({ ok: false });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('dismissWelcomeAction — сессия обязательна', () => {
  it('requireSession редиректит (throw) → update не вызывается', async () => {
    requireSession.mockRejectedValue(new Error('NEXT_REDIRECT'));

    await expect(dismissWelcomeAction()).rejects.toThrow('NEXT_REDIRECT');
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
