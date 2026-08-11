/**
 * Этап 9 (Т-35…Т-40): сервис отката на мокнутой призме — права и гейты,
 * скоуп руководителя, конфликты и распространение блокировки вверх, порядок
 * удаления, восстановление из before, статусы батча. Живой Postgres —
 * в import.stage9-rollback.integration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import {
  listImportBatches,
  planImportRollback,
  rollbackImport,
} from '@/lib/services/import/rollback';

const ADMIN = { sub: 'u-admin', role: 'admin' } as never;
const LEADER = {
  sub: 'u-leader',
  role: 'manager',
  managerRole: 'leader',
  companyId: 'co-1',
  managedOrgIds: [],
} as never;
const PLAIN_MANAGER = { sub: 'u-mgr', role: 'manager', managedOrgIds: [] } as never;

const NOW = Date.now();
const FRESH = new Date(NOW - 1000);
const OLD = new Date(NOW - 40 * 24 * 60 * 60 * 1000);

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: `row-${Math.random().toString(36).slice(2)}`,
    entity: 'organization',
    entityId: 'org-1',
    action: 'created',
    before: null,
    reverted: false,
    ...over,
  };
}

const ZERO_ORDER_COUNTS = {
  statusChanges: 0,
  documents: 0,
  commissionItems: 0,
  comments: 0,
  uploads: 0,
  threads: 0,
  items: 0,
  tasks: 0,
  dealNotes: 0,
  calendarEvents: 0,
};
const ZERO_ORG_COUNTS = {
  users: 0,
  organizationUsers: 0,
  students: 0,
  certificates: 0,
  deals: 0,
  clientRequests: 0,
  enrollmentRequests: 0,
  leads: 0,
  managers: 0,
  notifications: 0,
  commissionRateChanges: 0,
  tasks: 0,
  calendarEvents: 0,
  inboundMessages: 0,
  calls: 0,
  contacts: 0,
};

/**
 * Мок призмы: все справочные выборки пустые, всё переопределяется через over.
 * Каждому делегату — СВОИ vi.fn: расшаренный объект превращал override одного
 * делегата в override всех трёх.
 */
function makeDb(over: Record<string, unknown> = {}) {
  const delegate = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    groupBy: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn(),
    update: vi.fn(),
  });
  const db = {
    oneCImportBatch: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    oneCImportRow: { updateMany: vi.fn() },
    payment: delegate(),
    order: delegate(),
    organization: delegate(),
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
    ...over,
  };
  return db as any; // мок призмы; any в тестах разрешён политикой eslint
}

beforeEach(() => {
  recordAudit.mockClear();
});

describe('listImportBatches — список и скоуп (Т-39/Т-40)', () => {
  // Решение заказчика 11.08.2026 отменило прежний запрет: обычный менеджер
  // тоже импортирует, значит и историю своих импортов видит. Границу режет
  // скоуп (его организации), а не отказ по праву.
  it('обычный менеджер историю получает — скоуп режет содержимое, а не право', async () => {
    const res = await listImportBatches(makeDb(), PLAIN_MANAGER);
    expect(res.ok).toBe(true);
  });

  it('руководитель видит только батчи своей компании; статусы кнопки выводятся', async () => {
    const db = makeDb();
    db.oneCImportBatch.findMany.mockResolvedValue([
      {
        id: 'b1',
        createdAt: FRESH,
        fileName: 'a.xlsx',
        status: 'committed',
        counts: null,
        importedBy: { name: 'Иван' },
      },
      {
        id: 'b2',
        createdAt: OLD,
        fileName: 'b.xlsx',
        status: 'committed',
        counts: null,
        importedBy: null,
      },
      {
        id: 'b3',
        createdAt: FRESH,
        fileName: 'c.xlsx',
        status: 'rolled_back',
        counts: null,
        importedBy: null,
      },
      {
        id: 'b4',
        createdAt: FRESH,
        fileName: 'd.xlsx',
        status: 'rollback_partial',
        counts: null,
        importedBy: null,
      },
    ]);
    const res = await listImportBatches(db, LEADER);
    expect(db.oneCImportBatch.findMany.mock.calls[0][0].where).toEqual({ companyId: 'co-1' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.batches.map((b) => b.rollback)).toEqual([
      'available',
      'expired',
      'already_rolled_back',
      'available', // rollback_partial можно добить (§8.2 спеки)
    ]);
    expect(res.batches[0].importedByName).toBe('Иван');
  });

  it('admin — без фильтра компании', async () => {
    const db = makeDb();
    await listImportBatches(db, ADMIN);
    expect(db.oneCImportBatch.findMany.mock.calls[0][0].where).toEqual({});
  });
});

describe('гейты отката (Т-38/Т-40)', () => {
  it('not_found / чужая компания руководителя / already_rolled_back / expired', async () => {
    const db = makeDb();
    expect(await planImportRollback(db, ADMIN, { batchId: 'nope' })).toEqual({
      ok: false,
      error: 'not_found',
    });

    db.oneCImportBatch.findUnique.mockResolvedValue({
      id: 'b',
      createdAt: FRESH,
      companyId: 'co-OTHER',
      status: 'committed',
      rows: [],
    });
    expect(await planImportRollback(db, LEADER, { batchId: 'b' })).toEqual({
      ok: false,
      error: 'not_found',
    });

    db.oneCImportBatch.findUnique.mockResolvedValue({
      id: 'b',
      createdAt: FRESH,
      companyId: null,
      status: 'rolled_back',
      rows: [],
    });
    expect(await planImportRollback(db, ADMIN, { batchId: 'b' })).toEqual({
      ok: false,
      error: 'already_rolled_back',
    });

    db.oneCImportBatch.findUnique.mockResolvedValue({
      id: 'b',
      createdAt: OLD,
      companyId: null,
      status: 'committed',
      rows: [],
    });
    expect(await planImportRollback(db, ADMIN, { batchId: 'b' })).toEqual({
      ok: false,
      error: 'expired',
    });
  });

  it('откат чужого батча недоступен: orgs-скоуп (обычный менеджер и руководитель без компании)', async () => {
    const db = makeDb();
    // Решение заказчика 11.08.2026: право импорта у менеджера ЕСТЬ, но откат
    // чужого батча ему по-прежнему недоступен — режет скоуп, а не право.
    db.oneCImportBatch.findUnique.mockResolvedValue({
      id: 'b',
      createdAt: FRESH,
      companyId: 'co-1',
      status: 'committed',
      rows: [],
    });
    expect(await rollbackImport(db, PLAIN_MANAGER, { batchId: 'b', partial: false })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    const leaderNoCompany = {
      sub: 'l2',
      role: 'manager',
      managerRole: 'leader',
      companyId: null,
      managedOrgIds: [],
    } as never;
    db.oneCImportBatch.findUnique.mockResolvedValue({
      id: 'b',
      createdAt: FRESH,
      companyId: 'co-1',
      status: 'committed',
      rows: [],
    });
    expect(await rollbackImport(db, leaderNoCompany, { batchId: 'b', partial: false })).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});

describe('конфликты и распространение вверх (Т-36, §4.2)', () => {
  it('платёж в акте блокирует себя, свой созданный заказ и организацию; full → conflicts без записи', async () => {
    const rows = [
      row({ id: 'r-pay', entity: 'payment', entityId: 'pay-1' }),
      row({ id: 'r-ord', entity: 'order', entityId: 'ord-1' }),
      row({ id: 'r-org', entity: 'organization', entityId: 'org-1' }),
    ];
    const db = makeDb();
    db.oneCImportBatch.findUnique.mockResolvedValue({
      id: 'b',
      createdAt: FRESH,
      companyId: null,
      status: 'committed',
      rows,
    });
    db.payment.findMany.mockResolvedValue([
      {
        id: 'pay-1',
        externalId: 'P-1',
        orderId: 'ord-1',
        organizationId: 'org-1',
        _count: { commissionItems: 2 },
        commissionCorrection: null,
      },
    ]);
    db.order.findMany.mockResolvedValue([
      {
        id: 'ord-1',
        orderNumber: null, // метки падают в title (ветка `?? o.title`)
        title: 'Заказ',
        organizationId: 'org-1',
        _count: {
          statusChanges: 0,
          documents: 0,
          commissionItems: 0,
          comments: 0,
          uploads: 0,
          threads: 0,
          items: 0,
          tasks: 0,
          dealNotes: 0,
          calendarEvents: 0,
        },
      },
    ]);
    db.organization.findMany.mockResolvedValue([
      {
        id: 'org-1',
        name: 'ООО Тест',
        _count: {
          users: 0,
          organizationUsers: 0,
          students: 0,
          certificates: 0,
          deals: 0,
          clientRequests: 0,
          enrollmentRequests: 0,
          leads: 0,
          managers: 0,
          notifications: 0,
          commissionRateChanges: 0,
          tasks: 0,
          calendarEvents: 0,
          inboundMessages: 0,
          calls: 0,
          contacts: 0,
        },
      },
    ]);

    const res = await rollbackImport(db, ADMIN, { batchId: 'b', partial: false });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('conflicts');
    const codes = (res.conflicts ?? []).map((c) => `${c.entity}:${c.code}`).sort();
    expect(codes).toEqual([
      'order:blocked_by_child',
      'organization:blocked_by_child',
      'payment:payment_in_commission_act',
    ]);
    // Ничего не тронуто.
    expect(db.payment.deleteMany).not.toHaveBeenCalled();
    expect(db.oneCImportBatch.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('платёж без заказа блокирует организацию напрямую; удалённые вручную записи получают id-метки', async () => {
    const rows = [
      row({ id: 'r-pay', entity: 'payment', entityId: 'pay-1' }),
      row({ id: 'r-ord', entity: 'order', entityId: 'ord-1' }),
      row({ id: 'r-org', entity: 'organization', entityId: 'org-1' }),
    ];
    const db = makeDb();
    db.oneCImportBatch.findUnique.mockResolvedValue({
      id: 'b',
      createdAt: FRESH,
      companyId: null,
      status: 'committed',
      rows,
    });
    // Платёж с корректировкой, БЕЗ заказа и без externalId; заказ и организация
    // из батча уже удалены вручную из БД — метки падают в id.
    db.payment.findMany.mockResolvedValue([
      {
        id: 'pay-1',
        externalId: null,
        orderId: 'ord-1',
        organizationId: 'org-1',
        _count: { commissionItems: 0 },
        commissionCorrection: { id: 'corr-1' },
      },
    ]);
    const res = await planImportRollback(db, ADMIN, { batchId: 'b' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const byCode = new Map(res.plan.conflicts.map((c) => [`${c.entity}:${c.code}`, c]));
    expect(byCode.get('payment:payment_has_correction')?.label).toBe('pay-1'); // externalId нет
    expect(byCode.get('order:blocked_by_child')?.label).toBe('ord-1'); // записи в БД нет
    expect(byCode.get('organization:blocked_by_child')?.label).toBe('org-1');
  });

  it('чужой платёж на созданном заказе блокирует заказ (order_has_foreign_payments)', async () => {
    const rows = [row({ id: 'r-ord', entity: 'order', entityId: 'ord-1' })];
    const db = makeDb();
    db.oneCImportBatch.findUnique.mockResolvedValue({
      id: 'b',
      createdAt: FRESH,
      companyId: null,
      status: 'committed',
      rows,
    });
    db.order.findMany.mockResolvedValue([
      {
        id: 'ord-1',
        orderNumber: 'O-1',
        title: 'Заказ',
        organizationId: 'org-external',
        _count: {
          statusChanges: 0,
          documents: 0,
          commissionItems: 0,
          comments: 0,
          uploads: 0,
          threads: 0,
          items: 0,
          tasks: 0,
          dealNotes: 0,
          calendarEvents: 0,
        },
      },
    ]);
    db.payment.groupBy.mockResolvedValue([{ orderId: 'ord-1', _count: { _all: 2 } }]);
    const res = await planImportRollback(db, ADMIN, { batchId: 'b' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.conflicts).toEqual([
      {
        entity: 'order',
        entityId: 'ord-1',
        label: 'O-1',
        code: 'order_has_foreign_payments',
        count: 2,
      },
    ]);
  });

  it('partial, когда безопасных строк нет вовсе → conflicts', async () => {
    const rows = [row({ id: 'r-org', entity: 'organization', entityId: 'org-1' })];
    const db = makeDb();
    db.oneCImportBatch.findUnique.mockResolvedValue({
      id: 'b',
      createdAt: FRESH,
      companyId: null,
      status: 'committed',
      rows,
    });
    db.organization.findMany.mockResolvedValue([
      {
        id: 'org-1',
        name: 'ООО Тест',
        _count: {
          users: 3,
          organizationUsers: 0,
          students: 0,
          certificates: 0,
          deals: 0,
          clientRequests: 0,
          enrollmentRequests: 0,
          leads: 0,
          managers: 0,
          notifications: 0,
          commissionRateChanges: 0,
          tasks: 0,
          calendarEvents: 0,
          inboundMessages: 0,
          calls: 0,
          contacts: 0,
        },
      },
    ]);
    const res = await rollbackImport(db, ADMIN, { batchId: 'b', partial: true });
    expect(res).toMatchObject({ ok: false, error: 'conflicts' });
  });

  it('updated-строка с удалённой вручную записью — конфликт record_missing', async () => {
    const rows = [
      row({ id: 'r-upd', entity: 'order', entityId: 'ord-gone', action: 'updated', before: {} }),
    ];
    const db = makeDb();
    db.oneCImportBatch.findUnique.mockResolvedValue({
      id: 'b',
      createdAt: FRESH,
      companyId: null,
      status: 'committed',
      rows,
    });
    // order.findMany зовётся дважды: пусто для created-веток и пусто для
    // проверки существования updated-целей — записи нет.
    const res = await planImportRollback(db, ADMIN, { batchId: 'b' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.conflicts).toEqual([
      {
        entity: 'order',
        entityId: 'ord-gone',
        label: 'ord-gone',
        code: 'record_missing',
        count: 1,
      },
    ]);
  });
});

describe('сам откат (Т-35, Т-37, Т-38)', () => {
  type FindArgs = { where?: { id?: { in?: string[] } }; select?: { _count?: unknown } };
  function happyDb(rows: unknown[]) {
    const db = makeDb();
    db.oneCImportBatch.findUnique.mockResolvedValue({
      id: 'b',
      createdAt: FRESH,
      companyId: 'co-1',
      status: 'committed',
      rows,
    });
    // findMany обслуживает и created-ветку (select с _count → бесконфликтные
    // записи), и проверку существования updated-целей (только id).
    db.payment.findMany.mockImplementation(async (args: FindArgs) =>
      (args?.where?.id?.in ?? []).map((id: string) =>
        args?.select?._count
          ? {
              id,
              externalId: id,
              orderId: null,
              organizationId: 'org-external',
              _count: { commissionItems: 0 },
              commissionCorrection: null,
            }
          : { id }
      )
    );
    db.order.findMany.mockImplementation(async (args: FindArgs) =>
      (args?.where?.id?.in ?? []).map((id: string) =>
        args?.select?._count
          ? {
              id,
              orderNumber: id,
              title: id,
              organizationId: 'org-external',
              _count: { ...ZERO_ORDER_COUNTS },
            }
          : { id }
      )
    );
    db.organization.findMany.mockImplementation(async (args: FindArgs) =>
      (args?.where?.id?.in ?? []).map((id: string) =>
        args?.select?._count ? { id, name: id, _count: { ...ZERO_ORG_COUNTS } } : { id }
      )
    );
    return db;
  }

  it('полный откат: удаление платежи → заказы → организации, restore из before, статус rolled_back, аудит в транзакции', async () => {
    const rows = [
      row({ id: 'r1', entity: 'payment', entityId: 'pay-1' }),
      row({ id: 'r2', entity: 'order', entityId: 'ord-1' }),
      row({ id: 'r3', entity: 'organization', entityId: 'org-1' }),
      row({
        id: 'r4',
        entity: 'order',
        entityId: 'ord-upd',
        action: 'updated',
        before: {
          totalAmount: '100',
          paidAmount: '0',
          financialStatus: 'not_billed',
          executionStatus: 'pending',
        },
      }),
      row({
        id: 'r5',
        entity: 'organization',
        entityId: 'org-upd',
        action: 'updated',
        before: { name: 'Старое имя', inn: null, kpp: null, externalId: null, partnerId: null },
      }),
      row({
        id: 'r6',
        entity: 'payment',
        entityId: 'pay-upd',
        action: 'updated',
        before: { amount: '300', paidAt: '2026-07-01T00:00:00.000Z', purpose: null },
      }),
      // Снимка нет — восстанавливать нечего, строка просто помечается.
      row({ id: 'r7', entity: 'payment', entityId: 'pay-nobefore', action: 'updated' }),
    ];
    const db = happyDb(rows);
    const calls: string[] = [];
    db.payment.deleteMany.mockImplementation(async () => calls.push('payments'));
    db.order.deleteMany.mockImplementation(async () => calls.push('orders'));
    db.organization.deleteMany.mockImplementation(async () => calls.push('organizations'));

    const res = await rollbackImport(db, LEADER, { batchId: 'b', partial: false });
    expect(res).toEqual({
      ok: true,
      status: 'rolled_back',
      deleted: { organizations: 1, orders: 1, payments: 1 },
      restored: 4,
      skippedConflicts: 0,
    });
    // Т-35: обратный порядок.
    expect(calls).toEqual(['payments', 'orders', 'organizations']);
    expect(db.order.update).toHaveBeenCalledWith({
      where: { id: 'ord-upd' },
      data: {
        totalAmount: '100',
        paidAmount: '0',
        financialStatus: 'not_billed',
        executionStatus: 'pending',
      },
    });
    expect(db.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-upd' },
      data: { name: 'Старое имя', inn: null, kpp: null, externalId: null, partnerId: null },
    });
    expect(db.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-upd' },
      data: { amount: '300', paidAt: new Date('2026-07-01T00:00:00.000Z'), purpose: null },
    });
    // Строка без снимка запись не трогает, но помечается откаченной.
    expect(db.payment.update).toHaveBeenCalledTimes(1);
    expect(db.oneCImportRow.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'] } },
      data: { reverted: true },
    });
    expect(db.oneCImportBatch.update).toHaveBeenCalledWith({
      where: { id: 'b' },
      data: expect.objectContaining({ status: 'rolled_back', rolledBackById: 'u-leader' }),
    });
    // Т-38: аудит обязателен, в той же транзакции (тот же клиент tx=db).
    expect(recordAudit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: 'one_c_import.rollback',
        entityId: 'b',
        after: expect.objectContaining({ mode: 'full', status: 'rolled_back' }),
      })
    );
  });

  it('частичный откат: конфликтная организация остаётся, статус rollback_partial (Т-37)', async () => {
    const rows = [
      row({ id: 'r1', entity: 'payment', entityId: 'pay-1' }),
      row({ id: 'r3', entity: 'organization', entityId: 'org-conf' }),
    ];
    const db = happyDb(rows);
    db.payment.findMany.mockResolvedValue([
      {
        id: 'pay-1',
        externalId: 'P-1',
        orderId: null,
        organizationId: 'org-OTHER', // не из батча — распространения нет
        _count: { commissionItems: 0 },
        commissionCorrection: null,
      },
    ]);
    db.organization.findMany.mockResolvedValue([
      {
        id: 'org-conf',
        name: 'ООО Конфликт',
        _count: {
          users: 1,
          organizationUsers: 0,
          students: 0,
          certificates: 0,
          deals: 0,
          clientRequests: 0,
          enrollmentRequests: 0,
          leads: 0,
          managers: 0,
          notifications: 0,
          commissionRateChanges: 0,
          tasks: 0,
          calendarEvents: 0,
          inboundMessages: 0,
          calls: 0,
          contacts: 0,
        },
      },
    ]);

    const res = await rollbackImport(db, ADMIN, { batchId: 'b', partial: true });
    expect(res).toEqual({
      ok: true,
      status: 'rollback_partial',
      deleted: { organizations: 0, orders: 0, payments: 1 },
      restored: 0,
      skippedConflicts: 1,
    });
    expect(db.organization.deleteMany).not.toHaveBeenCalled();
    expect(db.oneCImportRow.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1'] } },
      data: { reverted: true },
    });
  });

  it('уже откаченные строки (reverted) в повторный прогон не попадают', async () => {
    const rows = [
      row({ id: 'r1', entity: 'payment', entityId: 'pay-1', reverted: true }),
      row({ id: 'r2', entity: 'order', entityId: 'ord-1' }),
    ];
    const db = happyDb(rows);
    const res = await rollbackImport(db, ADMIN, { batchId: 'b', partial: false });
    expect(res).toMatchObject({ ok: true, deleted: { payments: 0, orders: 1 } });
    expect(db.payment.deleteMany).not.toHaveBeenCalled();
  });
});
