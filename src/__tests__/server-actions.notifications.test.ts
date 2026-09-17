import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { markAllNotificationsRead } = vi.hoisted(() => ({ markAllNotificationsRead: vi.fn() }));
vi.mock('@/lib/services/notifications/inbox', () => ({ markAllNotificationsRead }));

import { markAllNotificationsReadAction } from '@/server-actions/notifications';

/**
 * Действие «Отметить все прочитанными» (`У-228`, `Р-Э5-8`): тонкий адаптер —
 * сессия, флаг, вызов сервиса, сброс кэша СВОЕГО раздела.
 */

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ sub: 'u1', role: 'manager' });
  isFeatureEnabled.mockReturnValue(true);
  markAllNotificationsRead.mockResolvedValue({ ok: true, updated: { count: 3 } });
});

describe('markAllNotificationsReadAction', () => {
  it('зовёт сервис с сессией и сбрасывает кэш раздела кабинета', async () => {
    const res = await markAllNotificationsReadAction('/manager/notifications');
    expect(res).toEqual({ ok: true, count: 3 });
    expect(markAllNotificationsRead).toHaveBeenCalledWith({}, { sub: 'u1', role: 'manager' });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/notifications');
  });

  it('без флага — отказ, сервис не зовётся', async () => {
    isFeatureEnabled.mockReturnValue(false);
    const res = await markAllNotificationsReadAction('/manager/notifications');
    expect(res).toEqual({ ok: false, error: 'feature_disabled' });
    expect(markAllNotificationsRead).not.toHaveBeenCalled();
  });
});
