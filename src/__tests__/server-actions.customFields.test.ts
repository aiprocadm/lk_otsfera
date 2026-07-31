import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSession, revalidatePath, setValues } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  setValues: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/customFields', () => ({ setValues }));

import { saveOrderCustomFieldsAction, saveCustomFieldsAction } from '@/server-actions/customFields';

const SESSION = { sub: 'mgr-1', role: 'manager', companyId: 'c1', managedOrgIds: [] };
const VALUES: Record<string, string | null> = { 'def-1': 'hello', 'def-2': null };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
});

describe('saveOrderCustomFieldsAction — happy path', () => {
  it('forwards orderId + values to setValues and returns ok:true', async () => {
    setValues.mockResolvedValue({ ok: true });
    const res = await saveOrderCustomFieldsAction('order-1', VALUES);

    expect(res).toEqual({ ok: true });
    expect(setValues).toHaveBeenCalledWith(
      {}, // prisma mock
      SESSION,
      'order',
      'order-1',
      VALUES
    );
  });

  it('revalidates manager, leader and admin order paths on success', async () => {
    setValues.mockResolvedValue({ ok: true });
    await saveOrderCustomFieldsAction('order-42', VALUES);

    expect(revalidatePath).toHaveBeenCalledWith('/manager/orders/order-42');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/orders/order-42');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/orders/order-42');
  });
});

describe('saveOrderCustomFieldsAction — error propagation', () => {
  it('returns forbidden from setValues without revalidating', async () => {
    setValues.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await saveOrderCustomFieldsAction('order-1', VALUES);

    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns not_found from setValues without revalidating', async () => {
    setValues.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await saveOrderCustomFieldsAction('order-1', VALUES);

    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns invalid_value from setValues without revalidating', async () => {
    setValues.mockResolvedValue({ ok: false, error: 'invalid_value' });
    const res = await saveOrderCustomFieldsAction('order-1', VALUES);

    expect(res).toEqual({ ok: false, error: 'invalid_value' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('re-throws unexpected errors (no swallowing)', async () => {
    setValues.mockRejectedValue(new Error('DB down'));
    await expect(saveOrderCustomFieldsAction('order-1', VALUES)).rejects.toThrow('DB down');
  });
});

describe('saveOrderCustomFieldsAction — session delegation', () => {
  it('passes the session obtained from requireSession to setValues', async () => {
    const adminSession = { sub: 'admin-1', role: 'admin' };
    requireSession.mockResolvedValue(adminSession);
    setValues.mockResolvedValue({ ok: true });

    await saveOrderCustomFieldsAction('order-1', {});
    expect(setValues).toHaveBeenCalledWith(expect.anything(), adminSession, 'order', 'order-1', {});
  });
});

describe('saveCustomFieldsAction — пути освежения для всех пяти сущностей', () => {
  // У каждой сущности свой набор путей: заявка живёт в трёх кабинетах,
  // сотрудник в двух, партнёр и документ — в админском. Без этой проверки
  // построители путей четырёх сущностей не исполнялись ни одним тестом
  // (найдено полным прогоном покрытия 30.07.2026 — метрика «функции»).
  it.each([
    ['organization', '/admin/organizations/e1'],
    ['partner', '/admin/partners/e1'],
    ['student', '/manager/students/e1'],
    ['document', '/admin/documents/e1'],
  ])('%s освежает свою карточку', async (entity, expectedPath) => {
    setValues.mockResolvedValue({ ok: true });
    revalidatePath.mockClear();

    const res = await saveCustomFieldsAction(entity as 'organization', 'e1', { d1: 'x' });

    expect(res).toEqual({ ok: true });
    expect(revalidatePath.mock.calls.map((c) => c[0])).toContain(expectedPath);
  });
});
