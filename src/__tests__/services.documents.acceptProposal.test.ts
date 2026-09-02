import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const {
  canReadDocument,
  setDocumentStatus,
  recordAudit,
  notifyManagers,
  getInitialStatusId,
  logWarn,
} = vi.hoisted(() => ({
  canReadDocument: vi.fn(),
  setDocumentStatus: vi.fn(),
  recordAudit: vi.fn(),
  notifyManagers: vi.fn(),
  getInitialStatusId: vi.fn(),
  logWarn: vi.fn(),
}));
vi.mock('@/lib/auth/policy', () => ({ canReadDocument }));
vi.mock('@/lib/services/documents/status', () => ({ setDocumentStatus }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/notifications', () => ({ notifyManagers }));
vi.mock('@/lib/services/orderStatuses/definitions', () => ({ getInitialStatusId }));
vi.mock('@/lib/logging', () => ({ log: { warn: logWarn, error: vi.fn(), info: vi.fn() } }));

import { acceptProposal } from '@/lib/services/documents/acceptProposal';

/**
 * `У-164` (этап 7) — принятие коммерческого предложения.
 *
 * Требование описывает ЧЕТЫРЕ исхода, и они отличаются не текстом, а тем, что
 * происходит с данными. Проверяем каждый, а сверх того — границы, из-за
 * которых действие опасно: чужая сделка, заказ из 1С, состав, набранный
 * руками, и заказ без организации.
 */
const STAFF = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-A' }) as unknown as SessionPayload;

const LINE = {
  title: 'Обучение',
  quantity: '2',
  unit: 'person' as const,
  unitPrice: '5000.00',
  discountPercent: null,
  vatRate: '0.2000',
  vatIncluded: true,
  sortOrder: 0,
};

const DOC = {
  id: 'kp-1',
  type: 'commercial_proposal',
  status: 'sent',
  number: 'КП-2026-4',
  companyId: 'co-A',
  orderId: null,
  counterpartyType: 'organization',
  counterpartyId: 'org-1',
  dealId: null as string | null,
  sentById: 'u-sender',
  uploadedById: 'u-author',
  order: null,
  lines: [LINE],
};

type Over = {
  /** `null` — документа нет вовсе (проверка «не найдено»). */
  doc?: Record<string, unknown> | null;
  deal?: Record<string, unknown> | null;
  order?: Record<string, unknown> | null;
  organization?: Record<string, unknown> | null;
};

function makePrisma(over: Over = {}) {
  const orderCreate = vi.fn(async (args: { data?: unknown }) => {
    void args;
    return { id: 'ord-new' };
  });
  const orderUpdate = vi.fn(async (args: { data?: unknown }) => {
    void args;
    return {};
  });
  const orderLineCreateMany = vi.fn(async (args: { data?: unknown }) => {
    void args;
    return { count: 1 };
  });
  const dealUpdate = vi.fn(async (args: { data?: unknown }) => {
    void args;
    return {};
  });
  const tx = {
    order: { create: orderCreate, update: orderUpdate },
    orderLine: { createMany: orderLineCreateMany },
    deal: { update: dealUpdate },
  };
  const prisma = {
    document: {
      findUnique: vi.fn(async () => (over.doc === null ? null : { ...DOC, ...(over.doc ?? {}) })),
    },
    deal: { findUnique: vi.fn(async () => over.deal ?? null) },
    order: { findUnique: vi.fn(async () => over.order ?? null) },
    organization: { findUnique: vi.fn(async () => over.organization ?? { partnerId: null }) },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaClient;
  return { prisma, orderCreate, orderUpdate, orderLineCreateMany, dealUpdate };
}

beforeEach(() => {
  vi.clearAllMocks();
  canReadDocument.mockResolvedValue(true);
  setDocumentStatus.mockResolvedValue({ ok: true });
  recordAudit.mockResolvedValue(undefined);
  notifyManagers.mockResolvedValue(undefined);
  getInitialStatusId.mockResolvedValue('status-new');
});

describe('acceptProposal — гейты', () => {
  it('документа нет либо он не виден — «не найдено», существование не подтверждаем', async () => {
    expect(
      await acceptProposal(makePrisma({ doc: null }).prisma, STAFF(), { documentId: 'x' })
    ).toEqual({
      ok: false,
      error: 'not_found',
    });

    canReadDocument.mockResolvedValue(false);
    expect(await acceptProposal(makePrisma().prisma, STAFF(), { documentId: 'kp-1' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('не предложение — отдельный отказ, а не «не найдено»', async () => {
    // Человек видит документ на экране: молчаливое «не найдено» выглядело бы
    // поломкой кнопки.
    const { prisma } = makePrisma({ doc: { type: 'invoice' } });
    expect(await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' })).toEqual({
      ok: false,
      error: 'not_a_proposal',
    });
  });

  it('предложение лида принять нечем: у заказа организация обязательна', async () => {
    // Сначала клиента заводят организацией — для этого есть отдельное
    // действие, и вместе с ней переезжает само предложение.
    const { prisma, orderCreate } = makePrisma({
      doc: { counterpartyType: null, counterpartyId: null },
    });
    expect(await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' })).toEqual({
      ok: false,
      error: 'organization_required',
    });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('заказ сделки пришёл из 1С — состав ведёт учётная система', async () => {
    const { prisma, orderLineCreateMany } = makePrisma({
      doc: { dealId: 'deal-1' },
      deal: {
        id: 'deal-1',
        companyId: 'co-A',
        organizationId: 'org-1',
        managerId: null,
        orderId: 'ord-1c',
      },
      order: { id: 'ord-1c', externalId: '1C-77', _count: { lines: 0 } },
    });
    expect(await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' })).toEqual({
      ok: false,
      error: 'order_from_1c',
    });
    expect(orderLineCreateMany).not.toHaveBeenCalled();
  });
});

describe('acceptProposal — четыре сценария требования', () => {
  it('1. организация без сделки: создаётся заказ со строками предложения', async () => {
    const { prisma, orderCreate } = makePrisma();
    const res = await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' });
    expect(res).toEqual({
      ok: true,
      orderId: 'ord-new',
      orderCreated: true,
      linesTransferred: 1,
      keptExistingLines: false,
    });
    const data = orderCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.organizationId).toBe('org-1');
    // Сумма считается тем же помощником, что и везде: 2 × 5000 = 10 000.
    expect(String(data.totalAmount)).toBe('10000.00');
  });

  it('2. сделка без заказа: заказ создаётся И связывается со сделкой', async () => {
    const { prisma, dealUpdate } = makePrisma({
      doc: { dealId: 'deal-1' },
      deal: {
        id: 'deal-1',
        companyId: 'co-A',
        organizationId: 'org-1',
        managerId: 'm-deal',
        orderId: null,
      },
    });
    const res = await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' });
    expect(res).toMatchObject({ ok: true, orderCreated: true });
    expect(dealUpdate).toHaveBeenCalledWith({
      where: { id: 'deal-1' },
      data: { orderId: 'ord-new' },
    });
  });

  it('3. сделка с ПУСТЫМ заказом: строки переносятся в существующий', async () => {
    const { prisma, orderCreate, orderLineCreateMany, orderUpdate } = makePrisma({
      doc: { dealId: 'deal-1' },
      deal: {
        id: 'deal-1',
        companyId: 'co-A',
        organizationId: 'org-1',
        managerId: null,
        orderId: 'ord-old',
      },
      order: { id: 'ord-old', externalId: null, _count: { lines: 0 } },
    });
    const res = await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' });
    expect(res).toEqual({
      ok: true,
      orderId: 'ord-old',
      orderCreated: false,
      linesTransferred: 1,
      keptExistingLines: false,
    });
    expect(orderCreate).not.toHaveBeenCalled();
    expect(orderLineCreateMany).toHaveBeenCalled();
    expect(orderUpdate).toHaveBeenCalled();
  });

  it('4. сделка с ЗАПОЛНЕННЫМ заказом: состав НЕ перезаписывается', async () => {
    // Перезапись стёрла бы работу менеджера. Это не ошибка — предложение
    // принято; экран обязан сказать, что состав остался прежним.
    const { prisma, orderLineCreateMany, orderUpdate } = makePrisma({
      doc: { dealId: 'deal-1' },
      deal: {
        id: 'deal-1',
        companyId: 'co-A',
        organizationId: 'org-1',
        managerId: null,
        orderId: 'ord-old',
      },
      order: { id: 'ord-old', externalId: null, _count: { lines: 3 } },
    });
    const res = await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' });
    expect(res).toEqual({
      ok: true,
      orderId: 'ord-old',
      orderCreated: false,
      linesTransferred: 0,
      keptExistingLines: true,
    });
    expect(orderLineCreateMany).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
  });
});

describe('acceptProposal — что попадает в заказ', () => {
  it('признак «цена с НДС» переносится как есть', async () => {
    // Восстановить его из суммы налога нельзя: при ставке 0 и при «не
    // облагается» результат неразличим, и сумма заказа разошлась бы с
    // напечатанной в предложении ровно на ставку.
    const { prisma, orderCreate } = makePrisma({
      doc: { lines: [{ ...LINE, vatIncluded: false }] },
    });
    await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' });
    const data = orderCreate.mock.calls[0]![0].data as {
      lines: { create: Array<Record<string, unknown>> };
    };
    expect(data.lines.create[0]!.vatIncluded).toBe(false);
    // Цена без НДС: 10 000 + 20 % = 12 000.
    expect(
      String((orderCreate.mock.calls[0]![0].data as Record<string, unknown>).totalAmount)
    ).toBe('12000.00');
  });

  it('ответственный — менеджер сделки, а НЕ тот, кто нажал', async () => {
    // Принять предложение может сам заказчик, и его пользователь стал бы
    // менеджером заказа.
    const { prisma, orderCreate } = makePrisma({
      doc: { dealId: 'deal-1' },
      deal: {
        id: 'deal-1',
        companyId: 'co-A',
        organizationId: 'org-1',
        managerId: 'm-deal',
        orderId: null,
      },
    });
    await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' });
    expect((orderCreate.mock.calls[0]![0].data as Record<string, unknown>).managerId).toBe(
      'm-deal'
    );
  });

  it('без сделки ответственным становится отправитель предложения', async () => {
    const { prisma, orderCreate } = makePrisma();
    await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' });
    expect((orderCreate.mock.calls[0]![0].data as Record<string, unknown>).managerId).toBe(
      'u-sender'
    );
  });

  it('партнёр организации попадает в заказ: иначе посредник теряет вознаграждение', async () => {
    const { prisma, orderCreate } = makePrisma({ organization: { partnerId: 'p-1' } });
    await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' });
    expect((orderCreate.mock.calls[0]![0].data as Record<string, unknown>).partnerId).toBe('p-1');
  });

  it('компания берётся у ДОКУМЕНТА, а не у организации', async () => {
    // У организации поле компании необязательное — заказ мог бы остаться без
    // компании-исполнителя.
    const { prisma, orderCreate } = makePrisma();
    await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' });
    expect((orderCreate.mock.calls[0]![0].data as Record<string, unknown>).companyId).toBe('co-A');
  });
});

describe('acceptProposal — статус, журнал и уведомление', () => {
  it('статус меняется через единственную дверь и ПОСЛЕ заказа', async () => {
    const { prisma } = makePrisma();
    await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' });
    expect(setDocumentStatus).toHaveBeenCalledWith(prisma, expect.anything(), {
      documentId: 'kp-1',
      to: 'accepted',
    });
  });

  it('заказ создан, а статус не сменился — заказ НЕ откатывается, его id возвращается', async () => {
    // Откат ради красоты состояния выбросил бы уже полезную работу. Человек
    // должен узнать, что заказ на месте, и поправить состояние руками.
    setDocumentStatus.mockResolvedValue({ ok: false, error: 'invalid_transition' });
    const { prisma } = makePrisma();
    expect(await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' })).toEqual({
      ok: false,
      error: 'status_failed',
      orderId: 'ord-new',
    });
  });

  it('в журнале видно, создан ли заказ и сколько строк переехало', async () => {
    const { prisma } = makePrisma();
    await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' });
    expect(recordAudit.mock.calls[0]![1]).toMatchObject({
      action: 'proposal_accepted',
      entity: 'document',
      entityId: 'kp-1',
      after: { orderId: 'ord-new', orderCreated: true, linesTransferred: 1 },
    });
  });

  it('сбой уведомления не отменяет принятия', async () => {
    notifyManagers.mockRejectedValue(new Error('почта недоступна'));
    const { prisma } = makePrisma();
    expect(await acceptProposal(prisma, STAFF(), { documentId: 'kp-1' })).toMatchObject({
      ok: true,
    });
    expect(logWarn).toHaveBeenCalled();
  });
});
