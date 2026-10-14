/**
 * Unit tests for src/lib/services/manager/distribution.ts (B4).
 * Covers: resolveAutoManager (org / partner / ambiguous), assignOrderManager
 * (manual + C8 candidate-company restriction), claimOrder (scope guard + self-assign).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
const { getCompanyTeamVisibility, canSeeOrder } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  canSeeOrder: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
// `У-283`: уведомление нового ответственного — отдельный модуль, здесь только факт вызова.
const { notifyOrderAssigned } = vi.hoisted(() => ({ notifyOrderAssigned: vi.fn() }));
vi.mock('@/lib/notifications/manager', () => ({ notifyOrderAssigned }));
// isLeaderSameCompany остаётся РЕАЛЬНЫМ (чистая функция): leader-bypass в claimOrder
// тестируется против настоящей границы «лидер + та же компания», а не мока.
vi.mock('@/lib/auth/managerPolicy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/managerPolicy')>()),
  getCompanyTeamVisibility,
  canSeeOrder,
}));

import {
  resolveAutoManager,
  assignOrderManager,
  claimOrder,
  transferOwnOrder,
} from '@/lib/services/manager/distribution';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: [],
  companyId: 'co-1',
};
const LEADER: SessionPayload = {
  sub: 'lead-1',
  role: 'leader',
  managedOrgIds: [],
  companyId: 'co-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  recordAudit.mockResolvedValue(undefined);
  getCompanyTeamVisibility.mockResolvedValue(false);
  canSeeOrder.mockReturnValue(true);
  notifyOrderAssigned.mockResolvedValue({ recipientsNotified: 1, emailsSent: 0, emailsSkipped: 1 });
});

describe('resolveAutoManager', () => {
  it('returns the single active manager attached to the organization', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([{ userId: 'mgr-9' }]);
    const prisma = { organizationManager: { findMany } } as never;
    expect(await resolveAutoManager(prisma, { organizationId: 'org-1' })).toBe('mgr-9');
  });

  it('returns null when the org has multiple attached managers (ambiguous)', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([{ userId: 'a' }, { userId: 'b' }]);
    const prisma = { organizationManager: { findMany } } as never;
    expect(await resolveAutoManager(prisma, { organizationId: 'org-1' })).toBeNull();
  });

  it('falls back to a unique partner-level manager when the org has none', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([]) // by org
      .mockResolvedValueOnce([{ userId: 'mgr-p' }, { userId: 'mgr-p' }]); // by partner (deduped → 1)
    const prisma = { organizationManager: { findMany } } as never;
    expect(await resolveAutoManager(prisma, { organizationId: 'org-1', partnerId: 'p-1' })).toBe(
      'mgr-p'
    );
  });

  it('returns null when partner-level attachment is ambiguous', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userId: 'x' }, { userId: 'y' }]);
    const prisma = { organizationManager: { findMany } } as never;
    expect(
      await resolveAutoManager(prisma, { organizationId: 'org-1', partnerId: 'p-1' })
    ).toBeNull();
  });

  it('returns null when there is no org attachment and no partner', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([]);
    const prisma = { organizationManager: { findMany } } as never;
    expect(await resolveAutoManager(prisma, { organizationId: 'org-1' })).toBeNull();
  });
});

describe('assignOrderManager', () => {
  it('invalid_manager when the candidate is not an active manager', async () => {
    const prisma = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ role: 'organization', isActive: true, companyId: 'co-1' }),
      },
    } as never;
    expect(
      await assignOrderManager(prisma, SESSION, { orderId: 'o1', managerUserId: 'u2' })
    ).toEqual({
      ok: false,
      error: 'invalid_manager',
    });
  });

  it('invalid_manager when the candidate does not exist', async () => {
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue(null) } } as never;
    expect(
      await assignOrderManager(prisma, SESSION, { orderId: 'o1', managerUserId: 'ghost' })
    ).toEqual({
      ok: false,
      error: 'invalid_manager',
    });
  });

  it('invalid_manager when restrictToCompanyId is set and the candidate is in another company (C8)', async () => {
    const orderFindUnique = vi.fn();
    const prisma = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ role: 'manager', isActive: true, companyId: 'co-OTHER' }),
      },
      order: { findUnique: orderFindUnique },
    } as never;
    expect(
      await assignOrderManager(prisma, SESSION, {
        orderId: 'o1',
        managerUserId: 'u2',
        restrictToCompanyId: 'co-1',
      })
    ).toEqual({ ok: false, error: 'invalid_manager' });
    // Rejected before the order lookup.
    expect(orderFindUnique).not.toHaveBeenCalled();
  });

  it('allows a same-company candidate when restrictToCompanyId is set', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ role: 'manager', isActive: true, companyId: 'co-1' }),
      },
      order: { findUnique: vi.fn().mockResolvedValue({ managerId: null }), update },
    } as never;
    const r = await assignOrderManager(prisma, SESSION, {
      orderId: 'o1',
      managerUserId: 'u2',
      restrictToCompanyId: 'co-1',
    });
    expect(r).toEqual({ ok: true, changed: true });
    expect(update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { managerId: 'u2' } });
  });

  it('кандидат с ролью leader валиден (контур Р-Л-4, ТЗ 2026-08-17)', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ role: 'leader', isActive: true, companyId: 'co-1' }),
      },
      order: { findUnique: vi.fn().mockResolvedValue({ managerId: null }), update },
    } as never;
    const r = await assignOrderManager(prisma, SESSION, { orderId: 'o1', managerUserId: 'ldr-1' });
    expect(r).toEqual({ ok: true, changed: true });
  });

  it('order_not_found when the order is missing', async () => {
    const prisma = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ role: 'manager', isActive: true, companyId: 'co-1' }),
      },
      order: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never;
    expect(
      await assignOrderManager(prisma, SESSION, { orderId: 'x', managerUserId: 'u2' })
    ).toEqual({
      ok: false,
      error: 'order_not_found',
    });
  });

  it('no-op when the manager is unchanged', async () => {
    const update = vi.fn();
    const prisma = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ role: 'manager', isActive: true, companyId: 'co-1' }),
      },
      order: { findUnique: vi.fn().mockResolvedValue({ managerId: 'u2' }), update },
    } as never;
    expect(
      await assignOrderManager(prisma, SESSION, { orderId: 'o1', managerUserId: 'u2' })
    ).toEqual({
      ok: true,
      changed: false,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('assigns a manager and audits', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ role: 'manager', isActive: true, companyId: 'co-1' }),
      },
      order: { findUnique: vi.fn().mockResolvedValue({ managerId: null }), update },
    } as never;
    const r = await assignOrderManager(prisma, SESSION, { orderId: 'o1', managerUserId: 'u2' });
    expect(r).toEqual({ ok: true, changed: true });
    expect(update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { managerId: 'u2' } });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'order_manager_changed',
        before: { managerId: null },
        after: { managerId: 'u2' },
      })
    );
  });

  it('clears the assignment when managerUserId is null (skips candidate check)', async () => {
    const userFindUnique = vi.fn();
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      user: { findUnique: userFindUnique },
      order: { findUnique: vi.fn().mockResolvedValue({ managerId: 'u2' }), update },
    } as never;
    const r = await assignOrderManager(prisma, SESSION, { orderId: 'o1', managerUserId: null });
    expect(r).toEqual({ ok: true, changed: true });
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { managerId: null } });
  });
});

describe('claimOrder', () => {
  const scopedOrder = (managerId: string | null) => ({
    managerId,
    organizationId: 'org-1',
    companyId: 'co-1',
  });

  it('not_found when the order is missing', async () => {
    const prisma = { order: { findUnique: vi.fn().mockResolvedValue(null) } } as never;
    expect(await claimOrder(prisma, SESSION, { orderId: 'x' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('forbidden when the order is out of the manager scope (C8 IDOR guard)', async () => {
    canSeeOrder.mockReturnValue(false);
    const update = vi.fn();
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(scopedOrder(null)), update },
    } as never;
    expect(await claimOrder(prisma, SESSION, { orderId: 'o-foreign' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('already_assigned when the order is claimed by another manager', async () => {
    const update = vi.fn();
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(scopedOrder('other')), update },
    } as never;
    expect(await claimOrder(prisma, SESSION, { orderId: 'o1' })).toEqual({
      ok: false,
      error: 'already_assigned',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('no-op when the order is already mine', async () => {
    const update = vi.fn();
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(scopedOrder('mgr-1')), update },
    } as never;
    expect(await claimOrder(prisma, SESSION, { orderId: 'o1' })).toEqual({
      ok: true,
      changed: false,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('leader bypass: лидер забирает незакреплённый заказ СВОЕЙ компании вне canSeeOrder (teamMode=false)', async () => {
    // Зеркалит isLeaderSameCompany-bypass деталки (getOrder): лидер видит заказ →
    // должен мочь и забрать его, иначе кнопка ведёт в forbidden.
    canSeeOrder.mockReturnValue(false);
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(scopedOrder(null)), update },
    } as never;
    expect(await claimOrder(prisma, LEADER, { orderId: 'o1' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { managerId: 'lead-1' } });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'order_self_assigned', after: { managerId: 'lead-1' } })
    );
  });

  it('обычный менеджер в той же точке (вне scope, своя компания) → forbidden', async () => {
    canSeeOrder.mockReturnValue(false);
    const update = vi.fn();
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(scopedOrder(null)), update },
    } as never;
    expect(await claimOrder(prisma, SESSION, { orderId: 'o1' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('лидер на заказ ДРУГОЙ компании → forbidden (bypass ограничен C8-границей)', async () => {
    canSeeOrder.mockReturnValue(false);
    const update = vi.fn();
    const prisma = {
      order: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ managerId: null, organizationId: 'org-9', companyId: 'co-OTHER' }),
        update,
      },
    } as never;
    expect(await claimOrder(prisma, LEADER, { orderId: 'o-foreign' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('leader bypass НЕ обходит прекондицию already_assigned', async () => {
    canSeeOrder.mockReturnValue(false);
    const update = vi.fn();
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(scopedOrder('other')), update },
    } as never;
    expect(await claimOrder(prisma, LEADER, { orderId: 'o1' })).toEqual({
      ok: false,
      error: 'already_assigned',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('claims an in-scope unassigned order and audits', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(scopedOrder(null)), update },
      auditLog: { create: vi.fn() },
    } as never;
    const r = await claimOrder(prisma, SESSION, { orderId: 'o1' });
    expect(r).toEqual({ ok: true, changed: true });
    expect(update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { managerId: 'mgr-1' } });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'order_self_assigned', after: { managerId: 'mgr-1' } })
    );
  });
});

// ─── `У-283` (ТЗ 13.10.2026): передача заказа и уведомление ────────────────────

function transferPrisma(
  order: unknown,
  candidate: unknown = { role: 'manager', isActive: true, companyId: 'co-1' }
) {
  const update = vi.fn().mockResolvedValue({});
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(candidate) },
    order: { findUnique: vi.fn().mockResolvedValue(order), update },
  } as never;
  return { prisma, update };
}

describe('assignOrderManager — уведомление нового ответственного (У-283)', () => {
  it('новый ответственный получает «Вам передан заказ»; актор передаётся, чтобы себе не слать', async () => {
    const { prisma } = transferPrisma({ managerId: 'mgr-1', title: 'Обучение по ОТ' });
    await assignOrderManager(prisma, LEADER, { orderId: 'o1', managerUserId: 'u2' });
    expect(notifyOrderAssigned).toHaveBeenCalledWith(prisma, {
      assigneeId: 'u2',
      orderId: 'o1',
      orderTitle: 'Обучение по ОТ',
      actorUserId: 'lead-1',
    });
  });

  it('снятие ответственного (null) никого не уведомляет', async () => {
    const { prisma } = transferPrisma({ managerId: 'mgr-1', title: 'Т' });
    await assignOrderManager(prisma, LEADER, { orderId: 'o1', managerUserId: null });
    expect(notifyOrderAssigned).not.toHaveBeenCalled();
  });

  it('без изменения — без уведомления', async () => {
    const { prisma } = transferPrisma({ managerId: 'u2', title: 'Т' });
    expect(
      await assignOrderManager(prisma, LEADER, { orderId: 'o1', managerUserId: 'u2' })
    ).toEqual({
      ok: true,
      changed: false,
    });
    expect(notifyOrderAssigned).not.toHaveBeenCalled();
  });

  it('сбой доставки не отменяет передачу (§3: fan-out деградирует молча, но с логом)', async () => {
    notifyOrderAssigned.mockRejectedValue(new Error('smtp down'));
    const { prisma, update } = transferPrisma({ managerId: 'mgr-1', title: 'Т' });
    expect(
      await assignOrderManager(prisma, LEADER, { orderId: 'o1', managerUserId: 'u2' })
    ).toEqual({
      ok: true,
      changed: true,
    });
    expect(update).toHaveBeenCalled();
  });

  it('сбой доставки не-Error значением тоже не роняет передачу', async () => {
    notifyOrderAssigned.mockRejectedValue('boom');
    const { prisma } = transferPrisma({ managerId: 'mgr-1', title: 'Т' });
    expect(
      (await assignOrderManager(prisma, LEADER, { orderId: 'o1', managerUserId: 'u2' })).ok
    ).toBe(true);
  });
});

describe('transferOwnOrder — менеджер передаёт свой заказ (У-283)', () => {
  it('свой заказ своей компании → передан коллеге, кандидат сужен компанией (C8)', async () => {
    const { prisma, update } = transferPrisma({
      managerId: 'mgr-1',
      companyId: 'co-1',
      title: 'Т',
    });
    expect(await transferOwnOrder(prisma, SESSION, { orderId: 'o1', toUserId: 'u2' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { managerId: 'u2' } });
  });

  it('чужой заказ (ответственный — другой) → forbidden, ничего не пишем', async () => {
    const { prisma, update } = transferPrisma({ managerId: 'mgr-OTHER', companyId: 'co-1' });
    expect(await transferOwnOrder(prisma, SESSION, { orderId: 'o1', toUserId: 'u2' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('заказ другой компании → forbidden', async () => {
    const { prisma } = transferPrisma({ managerId: 'mgr-1', companyId: 'co-OTHER' });
    expect((await transferOwnOrder(prisma, SESSION, { orderId: 'o1', toUserId: 'u2' })).ok).toBe(
      false
    );
  });

  it('сессия без компании → forbidden (deny-null)', async () => {
    const { prisma } = transferPrisma({ managerId: 'mgr-1', companyId: 'co-1' });
    expect(
      await transferOwnOrder(
        prisma,
        { ...SESSION, companyId: null },
        { orderId: 'o1', toUserId: 'u2' }
      )
    ).toEqual({ ok: false, error: 'forbidden' });
  });

  it('кандидат другой компании → invalid_manager', async () => {
    const { prisma, update } = transferPrisma(
      { managerId: 'mgr-1', companyId: 'co-1' },
      { role: 'manager', isActive: true, companyId: 'co-OTHER' }
    );
    expect(await transferOwnOrder(prisma, SESSION, { orderId: 'o1', toUserId: 'u2' })).toEqual({
      ok: false,
      error: 'invalid_manager',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('заказа нет → order_not_found', async () => {
    const { prisma } = transferPrisma(null);
    expect(await transferOwnOrder(prisma, SESSION, { orderId: 'o1', toUserId: 'u2' })).toEqual({
      ok: false,
      error: 'order_not_found',
    });
  });

  it('передать самому себе — ничего не меняется', async () => {
    const { prisma, update } = transferPrisma({ managerId: 'mgr-1', companyId: 'co-1' });
    expect(await transferOwnOrder(prisma, SESSION, { orderId: 'o1', toUserId: 'mgr-1' })).toEqual({
      ok: true,
      changed: false,
    });
    expect(update).not.toHaveBeenCalled();
  });
});
