/**
 * Отметка «Бухгалтерия подписана» — сервисный слой.
 *
 * §10 ТЗ v0.5 (этап 2, PR-4): из `orderLifecycle.ts` удалены переходы статуса,
 * осталась только эта функция. Прежний файл тестов удалён вместе с переходами —
 * здесь восстановлено покрытие оставшейся части.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

const { canSeeOrder, getCompanyTeamVisibility } = vi.hoisted(() => ({
  canSeeOrder: vi.fn(),
  getCompanyTeamVisibility: vi.fn(),
}));
vi.mock('@/lib/auth/managerPolicy', () => ({ canSeeOrder, getCompanyTeamVisibility }));

import { setOrderAccountingSigned } from '@/lib/services/manager/orderLifecycle';

const session = { sub: 'm1', role: 'manager', companyId: 'co1' } as SessionPayload;

function db(order: unknown) {
  const update = vi.fn().mockResolvedValue({});
  return {
    prisma: {
      order: { findUnique: vi.fn().mockResolvedValue(order), update },
    } as unknown as PrismaClient,
    update,
  };
}

beforeEach(() => {
  recordAudit.mockReset();
  canSeeOrder.mockReset().mockReturnValue(true);
  getCompanyTeamVisibility.mockReset().mockResolvedValue(false);
});

describe('setOrderAccountingSigned', () => {
  it('несуществующая заявка → not_found', async () => {
    const { prisma } = db(null);
    expect(await setOrderAccountingSigned(prisma, session, { orderId: 'x', signed: true })).toEqual(
      {
        ok: false,
        error: 'not_found',
      }
    );
  });

  it('заявка вне скоупа → forbidden', async () => {
    canSeeOrder.mockReturnValue(false);
    const { prisma } = db({
      id: 'o1',
      managerId: null,
      organizationId: null,
      companyId: 'co1',
      accountingSignedAt: null,
    });
    expect(
      await setOrderAccountingSigned(prisma, session, { orderId: 'o1', signed: true })
    ).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('простановка галочки пишет дату и аудит', async () => {
    const { prisma, update } = db({
      id: 'o1',
      managerId: 'm1',
      organizationId: null,
      companyId: 'co1',
      accountingSignedAt: null,
    });

    const res = await setOrderAccountingSigned(prisma, session, { orderId: 'o1', signed: true });

    expect(res).toEqual({ ok: true, changed: true });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'o1' } }));
    expect(update.mock.calls[0][0].data.accountingSignedAt).toBeInstanceOf(Date);
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'order_accounting_signed', after: { signed: true } })
    );
  });

  it('снятие галочки очищает дату', async () => {
    const { prisma, update } = db({
      id: 'o1',
      managerId: 'm1',
      organizationId: null,
      companyId: 'co1',
      accountingSignedAt: new Date('2026-07-01'),
    });

    const res = await setOrderAccountingSigned(prisma, session, { orderId: 'o1', signed: false });

    expect(res).toEqual({ ok: true, changed: true });
    expect(update.mock.calls[0][0].data.accountingSignedAt).toBeNull();
  });

  it('идемпотентность: то же значение — без записи и без аудита', async () => {
    const { prisma, update } = db({
      id: 'o1',
      managerId: 'm1',
      organizationId: null,
      companyId: 'co1',
      accountingSignedAt: new Date('2026-07-01'),
    });

    const res = await setOrderAccountingSigned(prisma, session, { orderId: 'o1', signed: true });

    expect(res).toEqual({ ok: true, changed: false });
    expect(update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
