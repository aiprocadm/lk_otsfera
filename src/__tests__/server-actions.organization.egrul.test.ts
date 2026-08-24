import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `У-94`: действие только принимает форму. Права и границы держит сервис —
 * проверяем ровно это: список полей ограничен, лишние ключи из формы до сервиса
 * не доходят, ревалидируются все три карточки.
 */
const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));

const { fillFromEgrul } = vi.hoisted(() => ({ fillFromEgrul: vi.fn() }));
vi.mock('@/lib/services/organization/egrul', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/organization/egrul')>(
    '@/lib/services/organization/egrul'
  );
  return { ...actual, fillFromEgrul };
});

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { fillOrgFromEgrulAction } from '@/server-actions/organization/egrul';

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ sub: 'u1', role: 'admin' });
  fillFromEgrul.mockResolvedValue({ ok: true, filled: ['inn'] });
});

describe('fillOrgFromEgrulAction (У-94)', () => {
  it('передаёт в сервис только поля из белого списка', async () => {
    await fillOrgFromEgrulAction({
      organizationId: 'org-1',
      values: { inn: '7707083893', name: 'подмена', partnerCommissionRate: '0.99' },
    });

    expect(fillFromEgrul).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      orgId: 'org-1',
      values: { inn: '7707083893' },
    });
  });

  it('обновляет карточку во всех трёх кабинетах сотрудников', async () => {
    await fillOrgFromEgrulAction({ organizationId: 'org-1', values: { inn: '1' } });
    for (const base of [
      '/admin/organizations',
      '/leader/organizations',
      '/manager/organizations',
    ]) {
      expect(revalidatePath).toHaveBeenCalledWith(`${base}/org-1`);
      expect(revalidatePath).toHaveBeenCalledWith(base);
    }
  });

  it('кривая форма — validation, сервис не зовётся', async () => {
    const res = await fillOrgFromEgrulAction({
      organizationId: '',
      values: { inn: '1' },
    });
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(fillFromEgrul).not.toHaveBeenCalled();
  });

  it('отказ сервиса возвращается как есть и ничего не ревалидирует', async () => {
    fillFromEgrul.mockResolvedValue({ ok: false, error: 'inn_taken' });
    const res = await fillOrgFromEgrulAction({ organizationId: 'org-1', values: { inn: '1' } });
    expect(res).toEqual({ ok: false, error: 'inn_taken' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
