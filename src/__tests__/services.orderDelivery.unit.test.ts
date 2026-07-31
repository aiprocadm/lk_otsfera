import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Этап 12 (Модуль 5, ФТ-5.1/5.2) — сервис передачи результата:
 * скоуп, готовность, идемпотентность (решение §6-3), уведомление и аудит.
 */

const { canSeeOrder, getCompanyTeamVisibility } = vi.hoisted(() => ({
  canSeeOrder: vi.fn(),
  getCompanyTeamVisibility: vi.fn(),
}));
vi.mock('@/lib/auth/managerPolicy', () => ({ canSeeOrder, getCompanyTeamVisibility }));

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

const { notifyOrgUsers } = vi.hoisted(() => ({ notifyOrgUsers: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers }));

import {
  deliverOrderResult,
  approveDeliverables,
  getOrderReadiness,
} from '@/lib/services/manager/orderDelivery';
import type { SessionPayload } from '@/lib/auth/jwt';

const session = { sub: 'm1', role: 'manager', companyId: 'co-1' } as unknown as SessionPayload;

const READY_ORDER = {
  id: 'o1',
  orderNumber: 'ЗК-1',
  title: 'Обучение',
  serviceType: 'training',
  organizationId: 'org-1',
  partnerId: null,
  managerId: 'm1',
  companyId: 'co-1',
  deliverablesApprovedAt: null,
  resultDeliveredAt: null,
  documents: [],
  items: [
    {
      id: 'i1',
      trainingStatus: 'certificate_issued',
      student: { name: 'Иванов' },
      certificate: { documentId: 'd1' },
    },
  ],
};

function makePrisma(order: unknown, scanDocs: Array<{ id: string; scanStatus: string }> = []) {
  const update = vi.fn().mockResolvedValue({});
  // Этап 12 PR-2: статусы сканов удостоверений дочитываются отдельной выборкой.
  const findManyDocuments = vi.fn().mockResolvedValue(scanDocs);
  const prisma = {
    order: { findUnique: vi.fn().mockResolvedValue(order), update },
    document: { findMany: findManyDocuments },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ order: { update } /* аудит пишется тем же tx */ })
    ),
  } as never;
  return { prisma, update, findManyDocuments };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  canSeeOrder.mockReturnValue(true);
  notifyOrgUsers.mockResolvedValue({ recipientsNotified: 1 });
});

describe('deliverOrderResult', () => {
  it('несуществующий заказ → not_found', async () => {
    const { prisma } = makePrisma(null);
    expect(await deliverOrderResult(prisma, session, 'ghost')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('заказ вне скоупа → forbidden, ничего не пишется', async () => {
    canSeeOrder.mockReturnValue(false);
    const { prisma, update } = makePrisma(READY_ORDER);
    expect(await deliverOrderResult(prisma, session, 'o1')).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(update).not.toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('заказ не готов → not_ready с расшифровкой, без записи и уведомления', async () => {
    const { prisma, update } = makePrisma({
      ...READY_ORDER,
      items: [{ ...READY_ORDER.items[0], certificate: null }],
    });
    const res = await deliverOrderResult(prisma, session, 'o1');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('not_ready');
      expect(res.readiness?.items[0]?.gaps).toEqual(['certificate_missing']);
    }
    expect(update).not.toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('готовый заказ: дата ставится, аудит пишется, клиент уведомляется', async () => {
    const { prisma, update } = makePrisma(READY_ORDER);
    const res = await deliverOrderResult(prisma, session, 'o1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.alreadyDelivered).toBe(false);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resultDeliveredById: 'm1' }),
      })
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'order_result_delivered', entity: 'order' })
    );
    expect(notifyOrgUsers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-1', type: 'order_result_delivered' })
    );
  });

  it('повторная передача — no-op: даты не двигаем, второго уведомления нет (§6-3)', async () => {
    const delivered = new Date('2026-07-01T10:00:00Z');
    const { prisma, update } = makePrisma({ ...READY_ORDER, resultDeliveredAt: delivered });
    const res = await deliverOrderResult(prisma, session, 'o1');
    expect(res).toEqual({ ok: true, deliveredAt: delivered, alreadyDelivered: true });
    expect(update).not.toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('сбой уведомления не откатывает передачу (best-effort §3)', async () => {
    notifyOrgUsers.mockRejectedValue(new Error('канал недоступен'));
    const { prisma, update } = makePrisma(READY_ORDER);
    const res = await deliverOrderResult(prisma, session, 'o1');
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalled();
  });

  it('сбой уведомления не-Error значением тоже не откатывает передачу', async () => {
    // Канал уведомлений может отвергнуть промис строкой; ветка String(err) в
    // логировании обязана отработать, иначе падение внутри catch отменило бы
    // уже совершённую передачу результата.
    notifyOrgUsers.mockRejectedValue('канал закрыт');
    const { prisma, update } = makePrisma(READY_ORDER);
    const res = await deliverOrderResult(prisma, session, 'o1');
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalled();
  });
});

describe('approveDeliverables (решение §6-2)', () => {
  const DOC_ORDER = {
    ...READY_ORDER,
    serviceType: 'document_development',
    items: [],
    documents: [{ direction: 'outgoing', scanStatus: 'clean' }],
  };

  it('ставит отметку и пишет аудит', async () => {
    const { prisma, update } = makePrisma(DOC_ORDER);
    const res = await approveDeliverables(prisma, session, 'o1');
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliverablesApprovedById: 'm1' }),
      })
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'order_deliverables_approved' })
    );
  });

  it('повторная отметка не сдвигает дату первого согласования', async () => {
    const approved = new Date('2026-06-01T09:00:00Z');
    const { prisma, update } = makePrisma({ ...DOC_ORDER, deliverablesApprovedAt: approved });
    expect(await approveDeliverables(prisma, session, 'o1')).toEqual({
      ok: true,
      approvedAt: approved,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('вне скоупа → forbidden', async () => {
    canSeeOrder.mockReturnValue(false);
    const { prisma } = makePrisma(DOC_ORDER);
    expect(await approveDeliverables(prisma, session, 'o1')).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('несуществующий заказ → not_found', async () => {
    const { prisma } = makePrisma(null);
    expect(await approveDeliverables(prisma, session, 'x')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('getOrderReadiness', () => {
  it('отдаёт готовность и дату передачи', async () => {
    const delivered = new Date('2026-07-02T12:00:00Z');
    const { prisma } = makePrisma({ ...READY_ORDER, resultDeliveredAt: delivered });
    const res = await getOrderReadiness(prisma, session, 'o1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.readiness.ready).toBe(true);
      expect(res.deliveredAt).toEqual(delivered);
    }
  });

  it('вне скоупа → forbidden; несуществующий → not_found', async () => {
    canSeeOrder.mockReturnValue(false);
    const a = makePrisma(READY_ORDER);
    expect(await getOrderReadiness(a.prisma, session, 'o1')).toEqual({
      ok: false,
      error: 'forbidden',
    });

    const b = makePrisma(null);
    expect(await getOrderReadiness(b.prisma, session, 'x')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

/**
 * Этап 12 PR-2 (ФТ-5.3): вердикт ClamAV по скану удостоверения. Скан
 * асинхронный, поэтому «заражённый файл не привязывается» действует здесь —
 * заражённый скан не закрывает чек-лист.
 */
describe('getOrderReadiness — статусы сканов удостоверений (PR-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCompanyTeamVisibility.mockResolvedValue(false);
    canSeeOrder.mockReturnValue(true);
  });

  it('заражённый скан → заказ не готов, пробел по слушателю', async () => {
    const { prisma } = makePrisma(READY_ORDER, [{ id: 'd1', scanStatus: 'infected' }]);
    const res = await getOrderReadiness(prisma, session, 'o1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.readiness.ready).toBe(false);
      expect(res.readiness.items[0]?.gaps).toEqual(['certificate_scan_infected']);
    }
  });

  it('скан ещё на проверке (pending) готовности не мешает', async () => {
    const { prisma } = makePrisma(READY_ORDER, [{ id: 'd1', scanStatus: 'pending' }]);
    const res = await getOrderReadiness(prisma, session, 'o1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.readiness.ready).toBe(true);
  });

  it('без сканов лишнего запроса к документам нет', async () => {
    const order = {
      ...READY_ORDER,
      items: [
        {
          id: 'i1',
          trainingStatus: 'certificate_issued',
          student: { name: 'Иванов' },
          certificate: { documentId: null },
        },
      ],
    };
    const { prisma, findManyDocuments } = makePrisma(order);
    const res = await getOrderReadiness(prisma, session, 'o1');
    expect(findManyDocuments).not.toHaveBeenCalled();
    expect(res.ok && res.readiness.items[0]?.gaps).toEqual(['certificate_scan_missing']);
  });

  it('заражённый скан блокирует и саму передачу', async () => {
    const { prisma, update } = makePrisma(READY_ORDER, [{ id: 'd1', scanStatus: 'infected' }]);
    const res = await deliverOrderResult(prisma, session, 'o1');
    expect(res).toMatchObject({ ok: false, error: 'not_ready' });
    expect(update).not.toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });
});
