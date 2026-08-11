import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { mayImportOneC } from '@/lib/auth/managerPolicy';
import { importScope } from '@/lib/services/oneCSync/scope';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Откат импорта 1С (ТЗ починки импорта, Т-35…Т-40).
 *
 * Права — те же, что на импорт (Т-25/Т-38): admin и руководитель; руководитель
 * видит и откатывает только батчи СВОЕЙ компании. Защита от разрушительного
 * отката (Т-36) расширена с минимума ТЗ до «любая обратная связь вне батча =
 * конфликт» (§4.2 спеки): иначе DELETE упёрся бы в FK с невнятной ошибкой.
 * Весь откат — одна интерактивная транзакция, конфликты пересчитываются
 * ВНУТРИ неё (план из диалога мог устареть), аудит — в той же транзакции.
 */

// Срок отката (Т-40); наружу не экспортируется — тексты UI несут «30 дней»
// словами, а не подстановкой (knip: неиспользуемый экспорт = красная сборка).
const ROLLBACK_WINDOW_DAYS = 30;
const WINDOW_MS = ROLLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000;

type Db = PrismaClient | Prisma.TransactionClient;

export type RollbackConflict = {
  entity: 'organization' | 'order' | 'payment';
  entityId: string;
  /** Что показать оператору: название организации / номер заказа или платежа. */
  label: string;
  /** Стабильный код причины — русский текст даёт словарь UI. */
  code: string;
  count: number;
};

export type ImportBatchListItem = {
  id: string;
  createdAt: string;
  fileName: string;
  importedByName: string | null;
  status: string;
  /** Производный признак для кнопки (Т-39/Т-40). */
  rollback: 'available' | 'expired' | 'already_rolled_back';
  counts: Prisma.JsonValue;
};

/**
 * Можно ли откатить батч. Правило одно на все каналы (`У-48`):
 * `rollback_partial` можно добить повторно (§8.2 спеки), `rolled_back` — нет,
 * после окна — `expired`.
 */
export function rollbackStateOf(
  status: string,
  createdAt: Date,
  now: number
): 'available' | 'expired' | 'already_rolled_back' {
  if (status === 'rolled_back') return 'already_rolled_back';
  return now - createdAt.getTime() > WINDOW_MS ? 'expired' : 'available';
}

/** Последние 20 батчей истории (Т-39); руководитель — только своя компания. */
export async function listImportBatches(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; batches: ImportBatchListItem[] } | { ok: false; error: 'forbidden' }> {
  if (!mayImportOneC(session)) return { ok: false, error: 'forbidden' };
  const scope = importScope(session);
  const raw = await prisma.oneCImportBatch.findMany({
    where: scope.kind === 'company' ? { companyId: scope.companyId } : {},
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      createdAt: true,
      fileName: true,
      status: true,
      counts: true,
      importedBy: { select: { name: true } },
    },
  });
  const now = Date.now();
  return {
    ok: true,
    batches: raw.map((b) => ({
      id: b.id,
      createdAt: b.createdAt.toISOString(),
      fileName: b.fileName,
      importedByName: b.importedBy?.name ?? null,
      status: b.status,
      rollback: rollbackStateOf(b.status, b.createdAt, now),
      counts: b.counts,
    })),
  };
}

type ActiveRow = {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  before: Prisma.JsonValue;
};

/** Обратные связи вне списка Т-36 показываются обобщённым кодом *_other_links. */
const ORDER_COUNTS = {
  statusChanges: true,
  documents: true,
  commissionItems: true,
  comments: true,
  uploads: true,
  threads: true,
  items: true,
  tasks: true,
  dealNotes: true,
  calendarEvents: true,
} as const;

const ORG_COUNTS = {
  users: true,
  organizationUsers: true,
  students: true,
  certificates: true,
  deals: true,
  clientRequests: true,
  enrollmentRequests: true,
  leads: true,
  managers: true,
  notifications: true,
  commissionRateChanges: true,
  tasks: true,
  calendarEvents: true,
  inboundMessages: true,
  calls: true,
  contacts: true,
} as const;

function push(
  conflicts: RollbackConflict[],
  entity: RollbackConflict['entity'],
  entityId: string,
  label: string,
  code: string,
  count: number
) {
  if (count > 0) conflicts.push({ entity, entityId, label, code, count });
}

/**
 * Конфликты активных строк батча (Т-36 + §4.2 спеки). Проверяются только
 * created-строки (restore полей updated-строк разрушительным не бывает) плюс
 * существование целей updated-строк («запись удалена вручную» — тоже конфликт,
 * проверяется здесь, а не ловлей P2025 в уже мёртвой транзакции).
 */
async function computeConflicts(
  db: Db,
  rows: ActiveRow[]
): Promise<{ conflicts: RollbackConflict[]; blockedRowIds: Set<string> }> {
  const conflicts: RollbackConflict[] = [];
  const blockedRowIds = new Set<string>();
  const created = (e: string) => rows.filter((r) => r.action === 'created' && r.entity === e);
  const updated = (e: string) => rows.filter((r) => r.action === 'updated' && r.entity === e);
  const createdPayIds = created('payment').map((r) => r.entityId);
  const createdOrderIds = created('order').map((r) => r.entityId);
  const createdOrgIds = created('organization').map((r) => r.entityId);
  const rowByEntityId = new Map(rows.map((r) => [`${r.entity}:${r.entityId}`, r]));
  const block = (entity: string, entityId: string) => {
    const row = rowByEntityId.get(`${entity}:${entityId}`);
    if (row) blockedRowIds.add(row.id);
  };

  // ── Платежи: акт комиссии / корректировка (Т-36) ──
  const payments = createdPayIds.length
    ? await db.payment.findMany({
        where: { id: { in: createdPayIds } },
        select: {
          id: true,
          externalId: true,
          orderId: true,
          organizationId: true,
          _count: { select: { commissionItems: true } },
          commissionCorrection: { select: { id: true } },
        },
      })
    : [];
  for (const p of payments) {
    const label = p.externalId ?? p.id;
    push(conflicts, 'payment', p.id, label, 'payment_in_commission_act', p._count.commissionItems);
    push(
      conflicts,
      'payment',
      p.id,
      label,
      'payment_has_correction',
      p.commissionCorrection ? 1 : 0
    );
    if (p._count.commissionItems > 0 || p.commissionCorrection) block('payment', p.id);
  }

  // ── Заказы: статусные переходы, документы, акт, чужие платежи, прочее (Т-36) ──
  const orders = createdOrderIds.length
    ? await db.order.findMany({
        where: { id: { in: createdOrderIds } },
        select: {
          id: true,
          orderNumber: true,
          title: true,
          organizationId: true,
          _count: { select: ORDER_COUNTS },
        },
      })
    : [];
  const foreignOrderPays = createdOrderIds.length
    ? await db.payment.groupBy({
        by: ['orderId'],
        where: { orderId: { in: createdOrderIds }, id: { notIn: createdPayIds } },
        _count: { _all: true },
      })
    : [];
  const foreignPaysByOrder = new Map(foreignOrderPays.map((g) => [g.orderId, g._count._all]));
  for (const o of orders) {
    const label = o.orderNumber ?? o.title;
    const c = o._count;
    push(conflicts, 'order', o.id, label, 'order_has_status_changes', c.statusChanges);
    push(conflicts, 'order', o.id, label, 'order_has_documents', c.documents);
    push(conflicts, 'order', o.id, label, 'order_in_commission_act', c.commissionItems);
    push(
      conflicts,
      'order',
      o.id,
      label,
      'order_has_foreign_payments',
      foreignPaysByOrder.get(o.id) ?? 0
    );
    const other =
      c.comments + c.uploads + c.threads + c.items + c.tasks + c.dealNotes + c.calendarEvents;
    push(conflicts, 'order', o.id, label, 'order_has_other_links', other);
    const total =
      c.statusChanges +
      c.documents +
      c.commissionItems +
      (foreignPaysByOrder.get(o.id) ?? 0) +
      other;
    if (total > 0) block('order', o.id);
  }

  // ── Организации: пользователи, заявки, сделки, …, чужие заказы/платежи (Т-36) ──
  const orgs = createdOrgIds.length
    ? await db.organization.findMany({
        where: { id: { in: createdOrgIds } },
        select: { id: true, name: true, _count: { select: ORG_COUNTS } },
      })
    : [];
  const foreignOrgOrders = createdOrgIds.length
    ? await db.order.groupBy({
        by: ['organizationId'],
        where: { organizationId: { in: createdOrgIds }, id: { notIn: createdOrderIds } },
        _count: { _all: true },
      })
    : [];
  const foreignOrgPays = createdOrgIds.length
    ? await db.payment.groupBy({
        by: ['organizationId'],
        where: { organizationId: { in: createdOrgIds }, id: { notIn: createdPayIds } },
        _count: { _all: true },
      })
    : [];
  const foreignOrdersByOrg = new Map(
    foreignOrgOrders.map((g) => [g.organizationId, g._count._all])
  );
  const foreignPaysByOrg = new Map(foreignOrgPays.map((g) => [g.organizationId, g._count._all]));
  for (const org of orgs) {
    const c = org._count;
    push(
      conflicts,
      'organization',
      org.id,
      org.name,
      'org_has_users',
      c.users + c.organizationUsers
    );
    push(
      conflicts,
      'organization',
      org.id,
      org.name,
      'org_has_requests',
      c.clientRequests + c.enrollmentRequests
    );
    push(conflicts, 'organization', org.id, org.name, 'org_has_deals', c.deals);
    push(conflicts, 'organization', org.id, org.name, 'org_has_certificates', c.certificates);
    push(conflicts, 'organization', org.id, org.name, 'org_has_students', c.students);
    push(conflicts, 'organization', org.id, org.name, 'org_has_leads', c.leads);
    push(
      conflicts,
      'organization',
      org.id,
      org.name,
      'org_has_foreign_orders',
      foreignOrdersByOrg.get(org.id) ?? 0
    );
    push(
      conflicts,
      'organization',
      org.id,
      org.name,
      'org_has_foreign_payments',
      foreignPaysByOrg.get(org.id) ?? 0
    );
    const other =
      c.managers +
      c.notifications +
      c.commissionRateChanges +
      c.tasks +
      c.calendarEvents +
      c.inboundMessages +
      c.calls +
      c.contacts;
    push(conflicts, 'organization', org.id, org.name, 'org_has_other_links', other);
    const total =
      c.users +
      c.organizationUsers +
      c.clientRequests +
      c.enrollmentRequests +
      c.deals +
      c.certificates +
      c.students +
      c.leads +
      (foreignOrdersByOrg.get(org.id) ?? 0) +
      (foreignPaysByOrg.get(org.id) ?? 0) +
      other;
    if (total > 0) block('organization', org.id);
  }

  // ── updated-строки: запись могла быть удалена вручную ──
  for (const [entity, delegate] of [
    ['organization', 'organization'],
    ['order', 'order'],
    ['payment', 'payment'],
  ] as const) {
    const ids = updated(entity).map((r) => r.entityId);
    if (ids.length === 0) continue;
    const found = new Set(
      (
        await (
          db[delegate] as { findMany: (a: unknown) => Promise<Array<{ id: string }>> }
        ).findMany({ where: { id: { in: ids } }, select: { id: true } })
      ).map((r) => r.id)
    );
    for (const r of updated(entity)) {
      if (!found.has(r.entityId)) {
        conflicts.push({
          entity,
          entityId: r.entityId,
          label: r.entityId,
          code: 'record_missing',
          count: 1,
        });
        blockedRowIds.add(r.id);
      }
    }
  }

  // ── Распространение блокировки ВВЕРХ (§4.2): платёж → его заказ → организация ──
  // Иначе удаление родителя упало бы по FK на оставшегося ребёнка.
  const blockedPayOrderIds = payments
    .filter((p) => rowBlocked(blockedRowIds, rowByEntityId, 'payment', p.id))
    .map((p) => p.orderId)
    .filter((x): x is string => !!x);
  for (const orderId of blockedPayOrderIds) {
    const row = rowByEntityId.get(`order:${orderId}`);
    if (row && r0IsCreated(row) && !blockedRowIds.has(row.id)) {
      blockedRowIds.add(row.id);
      const o = orders.find((x) => x.id === orderId);
      conflicts.push({
        entity: 'order',
        entityId: orderId,
        label: o?.orderNumber ?? o?.title ?? orderId,
        code: 'blocked_by_child',
        count: 1,
      });
    }
  }
  const blockedOrderOrgIds = orders
    .filter((o) => rowBlocked(blockedRowIds, rowByEntityId, 'order', o.id))
    .map((o) => o.organizationId)
    .filter((x): x is string => !!x);
  // Плюс организации заблокированных платежей без заказа (org-level платежи).
  for (const p of payments) {
    if (rowBlocked(blockedRowIds, rowByEntityId, 'payment', p.id)) {
      blockedOrderOrgIds.push(p.organizationId);
    }
  }
  for (const orgId of blockedOrderOrgIds) {
    const row = rowByEntityId.get(`organization:${orgId}`);
    if (row && r0IsCreated(row) && !blockedRowIds.has(row.id)) {
      blockedRowIds.add(row.id);
      const o = orgs.find((x) => x.id === orgId);
      conflicts.push({
        entity: 'organization',
        entityId: orgId,
        label: o?.name ?? orgId,
        code: 'blocked_by_child',
        count: 1,
      });
    }
  }

  return { conflicts, blockedRowIds };
}

const r0IsCreated = (r: ActiveRow) => r.action === 'created';
function rowBlocked(
  blocked: Set<string>,
  byEntityId: Map<string, ActiveRow>,
  entity: string,
  entityId: string
): boolean {
  // Индекс доказуемо валиден: entityId пришёл из выборки по created-строкам
  // этого же батча — ключ построен из того же списка rows.
  return blocked.has(byEntityId.get(`${entity}:${entityId}`)!.id);
}

type BatchGateError = 'forbidden' | 'not_found' | 'already_rolled_back' | 'expired';

async function loadBatchForRollback(
  db: Db,
  session: SessionPayload,
  batchId: string
): Promise<{ ok: true; rows: ActiveRow[] } | { ok: false; error: BatchGateError }> {
  if (!mayImportOneC(session)) return { ok: false, error: 'forbidden' };
  const batch = await db.oneCImportBatch.findUnique({
    where: { id: batchId },
    select: { id: true, createdAt: true, companyId: true, status: true, rows: true },
  });
  if (!batch) return { ok: false, error: 'not_found' };
  const scope = importScope(session);
  // Чужая компания для руководителя = «нет такого батча»: существование не раскрываем.
  if (scope.kind === 'company' && batch.companyId !== scope.companyId) {
    return { ok: false, error: 'not_found' };
  }
  if (scope.kind === 'orgs') return { ok: false, error: 'forbidden' };
  if (batch.status === 'rolled_back') return { ok: false, error: 'already_rolled_back' };
  if (Date.now() - batch.createdAt.getTime() > WINDOW_MS) return { ok: false, error: 'expired' };
  return { ok: true, rows: batch.rows.filter((r) => !r.reverted) };
}

export type RollbackPlan = {
  toDelete: { organizations: number; orders: number; payments: number };
  toRestore: number;
  conflicts: RollbackConflict[];
};

/** План для диалога Т-39: счётчики + конфликты, ничего не пишет. */
export async function planImportRollback(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { batchId: string }
): Promise<{ ok: true; plan: RollbackPlan } | { ok: false; error: BatchGateError }> {
  const gate = await loadBatchForRollback(prisma, session, args.batchId);
  if (!gate.ok) return gate;
  const { conflicts } = await computeConflicts(prisma, gate.rows);
  return {
    ok: true,
    plan: {
      toDelete: {
        organizations: gate.rows.filter(
          (r) => r.action === 'created' && r.entity === 'organization'
        ).length,
        orders: gate.rows.filter((r) => r.action === 'created' && r.entity === 'order').length,
        payments: gate.rows.filter((r) => r.action === 'created' && r.entity === 'payment').length,
      },
      toRestore: gate.rows.filter((r) => r.action === 'updated').length,
      conflicts,
    },
  };
}

function restoreData(entity: string, before: Record<string, unknown>): Record<string, unknown> {
  if (entity === 'organization') {
    return {
      name: before.name,
      inn: before.inn,
      kpp: before.kpp,
      externalId: before.externalId,
      partnerId: before.partnerId,
    };
  }
  if (entity === 'order') {
    return {
      totalAmount: before.totalAmount,
      paidAmount: before.paidAmount,
      financialStatus: before.financialStatus,
      executionStatus: before.executionStatus,
    };
  }
  return {
    amount: before.amount,
    paidAt: new Date(String(before.paidAt)),
    purpose: before.purpose,
  };
}

export type RollbackResult =
  | {
      ok: true;
      status: 'rolled_back' | 'rollback_partial';
      deleted: { organizations: number; orders: number; payments: number };
      restored: number;
      skippedConflicts: number;
    }
  | { ok: false; error: BatchGateError | 'conflicts'; conflicts?: RollbackConflict[] };

/**
 * Сам откат (Т-35, Т-37, Т-38): одна интерактивная транзакция, конфликты
 * пересчитываются внутри, обратный порядок платежи → заказы → организации,
 * аудит — в той же транзакции (не записался аудит — не выполнен и откат).
 */
export async function rollbackImport(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { batchId: string; partial: boolean }
): Promise<RollbackResult> {
  return prisma.$transaction(async (tx): Promise<RollbackResult> => {
    const gate = await loadBatchForRollback(tx, session, args.batchId);
    if (!gate.ok) return gate;
    const { conflicts, blockedRowIds } = await computeConflicts(tx, gate.rows);
    if (conflicts.length > 0 && !args.partial) {
      return { ok: false, error: 'conflicts', conflicts };
    }
    const safe = gate.rows.filter((r) => !blockedRowIds.has(r.id));
    if (safe.length === 0) return { ok: false, error: 'conflicts', conflicts };

    // Т-35: обратный порядок. deleteMany терпим к уже удалённым вручную записям.
    const ids = (entity: string, action: string) =>
      safe.filter((r) => r.entity === entity && r.action === action).map((r) => r.entityId);
    const delPay = ids('payment', 'created');
    const delOrder = ids('order', 'created');
    const delOrg = ids('organization', 'created');
    if (delPay.length) await tx.payment.deleteMany({ where: { id: { in: delPay } } });
    if (delOrder.length) await tx.order.deleteMany({ where: { id: { in: delOrder } } });
    if (delOrg.length) await tx.organization.deleteMany({ where: { id: { in: delOrg } } });

    const restoredIds = {
      organization: [] as string[],
      order: [] as string[],
      payment: [] as string[],
    };
    for (const row of safe) {
      if (row.action !== 'updated') continue;
      const before = row.before as Record<string, unknown> | null;
      // Без снимка восстанавливать нечего — строка просто помечается откаченной.
      if (before) {
        const data = restoreData(row.entity, before) as never;
        if (row.entity === 'organization') {
          await tx.organization.update({ where: { id: row.entityId }, data });
        } else if (row.entity === 'order') {
          await tx.order.update({ where: { id: row.entityId }, data });
        } else {
          await tx.payment.update({ where: { id: row.entityId }, data });
        }
      }
      if (row.entity === 'organization') restoredIds.organization.push(row.entityId);
      else if (row.entity === 'order') restoredIds.order.push(row.entityId);
      else restoredIds.payment.push(row.entityId);
    }

    await tx.oneCImportRow.updateMany({
      where: { id: { in: safe.map((r) => r.id) } },
      data: { reverted: true },
    });
    const remaining = gate.rows.length - safe.length;
    const status = remaining === 0 ? 'rolled_back' : 'rollback_partial';
    await tx.oneCImportBatch.update({
      where: { id: args.batchId },
      data: { status, rolledBackAt: new Date(), rolledBackById: session.sub },
    });

    // Т-38: аудит обязателен и живёт в этой же транзакции.
    await recordAudit(tx, {
      userId: session.sub,
      action: 'one_c_import.rollback',
      entity: 'one_c_import',
      entityId: args.batchId,
      after: {
        mode: args.partial ? 'partial' : 'full',
        status,
        deleted: { organizations: delOrg, orders: delOrder, payments: delPay },
        restored: restoredIds,
        skippedConflicts: conflicts.length,
      },
    });

    return {
      ok: true,
      status,
      deleted: { organizations: delOrg.length, orders: delOrder.length, payments: delPay.length },
      restored: safe.filter((r) => r.action === 'updated').length,
      skippedConflicts: conflicts.length,
    };
  });
}
