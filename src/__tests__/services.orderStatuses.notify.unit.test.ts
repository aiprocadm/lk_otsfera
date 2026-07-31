/**
 * §10 ТЗ v0.5 (раздел 18) — рассылка при смене статуса, крайние случаи.
 *
 * Тут проверяется то, что на живой базе не подстроишь: рассылка коллегам
 * падает НЕ ошибкой (строкой). Такое прилетает из чужих библиотек, и логгер
 * не должен на этом спотыкаться — иначе сбой рассылки уронил бы смену статуса,
 * хотя §3 CLAUDE.md требует мягкой деградации.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { notifyOrgUsers, notifyManagers } = vi.hoisted(() => ({
  notifyOrgUsers: vi.fn(),
  notifyManagers: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers, notifyManagers }));

const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { warn: logWarn, error: vi.fn(), info: vi.fn() } }));

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

const { getOrderedStatuses, findByAnchor } = vi.hoisted(() => ({
  getOrderedStatuses: vi.fn(),
  findByAnchor: vi.fn(),
}));
vi.mock('@/lib/services/orderStatuses/definitions', () => ({ getOrderedStatuses, findByAnchor }));

import { transitionOrderStatus } from '@/lib/services/orderStatuses/transitions';

const STATUSES = [
  {
    id: 'd',
    key: 'draft',
    label: 'Черновик',
    sortOrder: 1,
    isActive: true,
    isTerminal: false,
    anchor: null,
  },
  {
    id: 'a',
    key: 'accepted',
    label: 'Принято в работу',
    sortOrder: 2,
    isActive: true,
    isTerminal: false,
    anchor: null,
  },
];

const ORDER = {
  id: 'o1',
  managerId: 'admin1',
  organizationId: 'org1',
  companyId: 'co1',
  statusId: 'd',
  orderNumber: 'ON-1',
  title: 'Заявка',
  serviceType: 'document_development',
  accountingSignedAt: null,
  documents: [],
  items: [],
};

function prismaStub() {
  return {
    order: { findUnique: async () => ORDER, update: async () => ORDER },
    orderStatusChange: { create: async () => ({}) },
    user: { findUnique: async () => ({ name: 'Иванов' }) },
  } as unknown as PrismaClient;
}

const admin = { sub: 'admin1', role: 'admin', companyId: 'co1' } as SessionPayload;

beforeEach(() => {
  getOrderedStatuses.mockResolvedValue(STATUSES);
  notifyOrgUsers.mockReset().mockResolvedValue(undefined);
  notifyManagers.mockReset();
  logWarn.mockReset();
  recordAudit.mockReset();
});

describe('смена статуса — сбой рассылки коллегам', () => {
  it('падение строкой (не Error) логируется и НЕ ломает смену статуса', async () => {
    notifyManagers.mockRejectedValue('внезапно строка');

    const res = await transitionOrderStatus(prismaStub(), admin, { orderId: 'o1', toId: 'a' });

    expect(res).toEqual({ ok: true, changed: true, statusId: 'a' });
    expect(logWarn).toHaveBeenCalledWith(
      '[orderStatuses] notifyManagers failed',
      expect.objectContaining({ error: 'внезапно строка' })
    );
  });

  it('падение настоящей ошибкой логируется её текстом', async () => {
    notifyManagers.mockRejectedValue(new Error('почта недоступна'));

    const res = await transitionOrderStatus(prismaStub(), admin, { orderId: 'o1', toId: 'a' });

    expect(res.ok).toBe(true);
    expect(logWarn).toHaveBeenCalledWith(
      '[orderStatuses] notifyManagers failed',
      expect.objectContaining({ error: 'почта недоступна' })
    );
  });

  it('заявка без организации — клиентам не шлём, статус меняется', async () => {
    notifyManagers.mockResolvedValue(undefined);
    const prisma = {
      order: {
        findUnique: async () => ({ ...ORDER, organizationId: null }),
        update: async () => ({}),
      },
      orderStatusChange: { create: async () => ({}) },
      user: { findUnique: async () => ({ name: 'Иванов' }) },
    } as unknown as PrismaClient;

    const res = await transitionOrderStatus(prisma, admin, { orderId: 'o1', toId: 'a' });

    expect(res.ok).toBe(true);
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });
});
