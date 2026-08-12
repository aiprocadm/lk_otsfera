import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Действие переключения флага (`У-65`). Тонкий адаптер: сессия → сервис →
 * обновление страницы. Права и запрет на флаги разделов живут в сервисе (§3),
 * здесь проверяем, что действие ничего не теряет и не выдумывает.
 */
const { requireSession } = vi.hoisted(() => ({
  requireSession: vi.fn(async () => ({ sub: 'u1', role: 'admin' })),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));

const { setFeatureFlag } = vi.hoisted(() => ({ setFeatureFlag: vi.fn() }));
vi.mock('@/lib/services/admin/featureFlags', () => ({ setFeatureFlag }));

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { setFeatureFlagAction } from '@/server-actions/feature-flags';

beforeEach(() => {
  setFeatureFlag.mockReset();
  revalidatePath.mockClear();
});

describe('setFeatureFlagAction', () => {
  it('передаёт флаг и значение в сервис и обновляет экран', async () => {
    setFeatureFlag.mockResolvedValue({ ok: true, enabled: true, source: 'ui' });
    const res = await setFeatureFlagAction('staff_chat', true);

    expect(res).toEqual({ ok: true, enabled: true, source: 'ui' });
    expect(setFeatureFlag.mock.calls[0]![2]).toEqual({ flag: 'staff_chat', enabled: true });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/system/feature-flags');
  });

  it('сброс к настройке сервера передаётся как null', async () => {
    setFeatureFlag.mockResolvedValue({ ok: true, enabled: false, source: 'env' });
    await setFeatureFlagAction('staff_chat', null);
    expect(setFeatureFlag.mock.calls[0]![2]).toEqual({ flag: 'staff_chat', enabled: null });
  });

  it('отказ сервиса возвращается как есть и экран не обновляется', async () => {
    setFeatureFlag.mockResolvedValue({ ok: false, error: 'not_editable' });
    expect(await setFeatureFlagAction('manager_cabinet', true)).toEqual({
      ok: false,
      error: 'not_editable',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
