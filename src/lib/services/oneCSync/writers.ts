import type { DocumentType, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { notifyOrgUsers, notifyManagers } from '@/lib/notifications';
import { resolveAutoManager } from '@/lib/services/manager/distribution';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { log } from '@/lib/logging';
import { notifyInvoicesPaid } from '@/lib/services/documents/invoicePaidNotice';
import { setDocumentStatus } from '@/lib/services/documents/status';
import { organizationNameKey } from '@/lib/services/import/oneCAccountCard/counterparty-key';
import {
  mapOrderDto,
  mapPaymentDto,
  mapOrgDto,
  mapDocumentDto,
  ORG_REQUISITE_KEYS,
} from './mappers';
import type { DocumentUpsertInput, OrgRequisites } from './mappers';
import { normalizeInn } from './inn';
import { resolveOrganizationRef } from './resolve-org';
import { fetchAndStore1CDocument } from './document-fetch';
import type { OneCOrderDto, OneCPaymentDto, OneCOrgDto, OneCDocumentDto } from './dto';
import type { BatchSummary } from './record-batch';
import type { OneCMode } from './config';
import type { ImportScope } from './scope';

export type WriteCtx = {
  mode: OneCMode;
  notify: boolean;
  scope?: ImportScope;
  /**
   * Компания для НОВЫХ организаций (Т-41): admin передаёт выбор из формы
   * импорта, воркер — `ONE_C_COMPANY_ID` из конфига. Для скоупа `company`
   * поле игнорируется — компания руководителя всегда побеждает (C8).
   */
  createCompanyId?: string;
  bump?: (iso: string) => void;
};
const isLive = (c: WriteCtx) => c.mode === 'live';

/**
 * Результат writer'а (ТЗ починки импорта, Т-34) — сырьё для истории импорта и
 * отката (этап 9). `undefined` — запись не менялась: skip, shadow-режим
 * (записи нет — откатывать нечего). `before` — только для `updated` и только
 * поля, которые импорт трогает (список Т-33); Decimal/DateTime — строками.
 */
export type WriteOutcome = {
  entityId: string;
  action: 'created' | 'updated';
  before?: Record<string, unknown>;
};

export function orgInScope(
  scope: ImportScope | undefined,
  target: { id: string | null; companyId: string | null }
): boolean {
  if (!scope || scope.kind === 'global') return true;
  // manager-leader: the target's company must be the leader's own company (C8).
  if (scope.kind === 'company')
    return target.companyId != null && target.companyId === scope.companyId;
  // plain manager: the target org must be one of the assigned orgs.
  return target.id != null && scope.allowedOrgIds.includes(target.id);
}

/**
 * May this scope create a BRAND-NEW org? Since stage 6 (Т-41/Т-43) creation no
 * longer mints a Company: the new org is attached to an existing one — the
 * leader's own for kind:'company' (C8 holds: the write stays INSIDE their
 * tenant), the form-selected/configured one for admin (kind:'global', Model A)
 * and the unscoped headless worker. Only an orgs-scoped actor (plain manager)
 * is still denied: creating would silently widen their assigned-orgs scope.
 */
export function mayCreateOrg(scope: ImportScope | undefined): boolean {
  return !scope || scope.kind === 'global' || scope.kind === 'company';
}

export async function upsertOrderRecord(
  db: PrismaClient,
  dto: OneCOrderDto,
  sum: BatchSummary,
  ctx: WriteCtx
): Promise<WriteOutcome | undefined> {
  const input = mapOrderDto(dto);
  const org = await resolveOrganizationRef(
    db,
    { externalId: input.organizationExternalId, inn: input.organizationInn },
    isLive(ctx)
  );
  if (!org || !org.companyId) {
    sum.skipped += 1;
    sum.skips.push({ externalId: input.externalId, reason: 'organization_not_found' });
    return undefined;
  }
  if (!orgInScope(ctx.scope, { id: org.id, companyId: org.companyId })) {
    sum.skipped += 1;
    sum.skips.push({ externalId: input.externalId, reason: 'out_of_scope' });
    return undefined;
  }
  const existing = await db.order.findUnique({
    where: { externalId: input.externalId },
    select: {
      id: true,
      organizationId: true,
      financialStatus: true,
      orderNumber: true,
      title: true,
      // Снимок «до» для истории импорта (Т-33): финансовое ядро заказа.
      totalAmount: true,
      paidAmount: true,
      executionStatus: true,
    },
  });
  const ownedBy1C = {
    orderNumber: input.orderNumber,
    title: input.title,
    totalAmount: input.totalAmount,
    paidAmount: input.paidAmount,
    paidAt: input.paidAt,
    contractSignedAt: input.contractSignedAt,
    completedAt: input.completedAt,
    closedAt: input.closedAt,
    vatIncluded: input.vatIncluded,
    vatRate: input.vatRate,
    financialStatus: input.financialStatus,
    productMix: input.productMix,
    lastSyncedAt: new Date(),
  };
  if (existing) {
    if (isLive(ctx)) {
      await db.order.update({
        where: { id: existing.id },
        data:
          existing.organizationId === null ? { ...ownedBy1C, organizationId: org.id } : ownedBy1C,
      });
    }
    sum.updated += 1;
    ctx.bump?.(dto.updatedAt);
    const targetOrgId = existing.organizationId ?? org.id;
    if (
      ctx.notify &&
      isLive(ctx) &&
      targetOrgId &&
      existing.financialStatus !== input.financialStatus
    ) {
      try {
        await notifyOrgUsers(db, {
          organizationId: targetOrgId,
          type: 'order_status_changed',
          payload: {
            orderId: existing.id,
            orderNumber: existing.orderNumber,
            orderTitle: existing.title,
            dimension: 'financial',
            oldStatus: existing.financialStatus,
            newStatus: input.financialStatus,
          },
        });
      } catch (err) {
        log.warn('[1c] order status notifyOrgUsers failed', err);
      }
    }
    if (!isLive(ctx)) return undefined;
    return {
      entityId: existing.id,
      action: 'updated',
      before: {
        totalAmount: String(existing.totalAmount),
        paidAmount: String(existing.paidAmount),
        financialStatus: existing.financialStatus,
        executionStatus: existing.executionStatus,
      },
    };
  } else {
    let createdId: string | undefined;
    if (isLive(ctx)) {
      // B4 (§5.3): auto-assign the org's (or partner's) single attached manager at
      // creation. Best-effort — a resolver failure must not block the order import (§3).
      let managerId: string | null = null;
      try {
        managerId = await resolveAutoManager(db, {
          organizationId: org.id,
          partnerId: org.partnerId,
        });
      } catch (err) {
        log.warn('[1c] auto-assign manager failed', err);
      }
      const created = await db.order.create({
        data: {
          ...ownedBy1C,
          externalId: input.externalId,
          executionStatus: input.executionStatus,
          companyId: org.companyId,
          partnerId: org.partnerId,
          organizationId: org.id,
          ...(managerId ? { managerId } : {}),
        },
        select: { id: true },
      });
      createdId = created.id;
    }
    sum.created += 1;
    ctx.bump?.(dto.updatedAt);
    return createdId ? { entityId: createdId, action: 'created' } : undefined;
  }
}

export async function upsertPaymentRecord(
  db: PrismaClient,
  dto: OneCPaymentDto,
  sum: BatchSummary,
  ctx: WriteCtx
): Promise<WriteOutcome | undefined> {
  const input = mapPaymentDto(dto);
  let orderId: string | null = null;
  let organizationId: string | null = null;
  let order: {
    id: string;
    organizationId: string | null;
    companyId: string;
    orderNumber: string | null;
    title: string;
  } | null = null;

  if (input.orderExternalId) {
    order = await db.order.findUnique({
      where: { externalId: input.orderExternalId },
      select: { id: true, organizationId: true, companyId: true, orderNumber: true, title: true },
    });
    if (!order) {
      sum.skipped += 1;
      sum.skips.push({ externalId: input.externalId, reason: 'order_not_found' });
      return;
    }
    // C8: enforce the tenant floor on the order's own company (required field), so a
    // company-scoped leader cannot attach a payment to another company's order.
    if (!orgInScope(ctx.scope, { id: order.organizationId, companyId: order.companyId })) {
      sum.skipped += 1;
      sum.skips.push({ externalId: input.externalId, reason: 'out_of_scope' });
      return;
    }
    orderId = order.id;
    organizationId = order.organizationId;
  } else {
    const org = await resolveOrganizationRef(
      db,
      {
        // `У-88`: локальный адрес — первым; по нему адресуются организации без
        // ИНН, которые иначе резолвер не нашёл бы.
        id: input.organizationId,
        externalId: input.organizationExternalId,
        inn: input.organizationInn,
      },
      isLive(ctx)
    );
    if (!org) {
      sum.skipped += 1;
      sum.skips.push({ externalId: input.externalId, reason: 'organization_not_found' });
      return;
    }
    if (!orgInScope(ctx.scope, { id: org.id, companyId: org.companyId })) {
      sum.skipped += 1;
      sum.skips.push({ externalId: input.externalId, reason: 'out_of_scope' });
      return;
    }
    organizationId = org.id;
  }

  if (!organizationId) {
    sum.skipped += 1;
    sum.skips.push({ externalId: input.externalId, reason: 'organization_not_found' });
    return;
  }

  const existing = await db.payment.findUnique({
    where: { externalId: input.externalId },
    // amount/paidAt/purpose — снимок «до» для истории импорта (Т-33).
    select: { id: true, amount: true, paidAt: true, purpose: true },
  });
  const updatable = {
    amount: input.amount,
    paidAt: input.paidAt,
    method: input.method,
    isRefund: input.isRefund,
    purpose: input.purpose,
    paymentOrderNumber: input.paymentOrderNumber,
    vatAmount: input.vatAmount,
  };
  if (existing) {
    if (isLive(ctx)) await db.payment.update({ where: { id: existing.id }, data: updatable });
    sum.updated += 1;
    ctx.bump?.(dto.updatedAt);
    if (!isLive(ctx)) return undefined;
    // `У-148`: исправленная сумма тоже способна закрыть счёт.
    if (ctx.notify && orderId) {
      try {
        await notifyInvoicesPaid(db, orderId);
      } catch (err) {
        log.warn('[1c] invoice paid notice failed', err);
      }
    }
    return {
      entityId: existing.id,
      action: 'updated',
      before: {
        amount: String(existing.amount),
        paidAt: existing.paidAt.toISOString(),
        purpose: existing.purpose,
      },
    };
  } else {
    let createdId: string | undefined;
    // enteredById: WriteCtx carries no acting-user id (1C sync / file import actor);
    // manual-entry wiring is future work (§7.1).
    if (isLive(ctx)) {
      const created = await db.payment.create({
        data: {
          ...updatable,
          externalId: input.externalId,
          orderId,
          organizationId,
          enteredById: null,
        },
        select: { id: true },
      });
      createdId = created.id;
    }
    sum.created += 1;
    ctx.bump?.(dto.updatedAt);
    if (ctx.notify && isLive(ctx) && order && order.organizationId && !input.isRefund) {
      try {
        await notifyOrgUsers(db, {
          organizationId: order.organizationId,
          type: 'payment_received',
          payload: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            orderTitle: order.title,
            amount: input.amount.toString(),
            paidAt: input.paidAt,
          },
        });
      } catch (err) {
        log.warn('[1c] payment notifyOrgUsers failed', err);
      }
    }
    if (ctx.notify && isLive(ctx) && order && !input.isRefund) {
      try {
        await notifyManagers(db, {
          orderId: order.id,
          type: 'order_marked_paid_by_1c',
          payload: { amount: Number(input.amount), paidAt: input.paidAt },
        });
      } catch (err) {
        log.warn('[1c] payment notifyManagers failed', err);
      }
    }
    // `У-148`, `У-159`: приход денег — единственный момент, когда счёт может
    // стать оплаченным. Считаем и сообщаем здесь же.
    if (ctx.notify && isLive(ctx) && orderId) {
      try {
        await notifyInvoicesPaid(db, orderId);
      } catch (err) {
        log.warn('[1c] invoice paid notice failed', err);
      }
    }
    return createdId ? { entityId: createdId, action: 'created' } : undefined;
  }
}

/**
 * `У-171` (`Д-23`): пустое из 1С не затирает заполненное у нас. В `update`
 * попадают только реквизиты со значением — иначе первый же обмен стёр бы
 * адрес или банк, которые менеджер вводил руками в карточке организации, и
 * это была бы потеря данных. Правило одно на все двенадцать полей, включая
 * ИНН и КПП. «Пусто» — это `null`: `''` и пробелы к нему свёл маппер
 * (`mapOrgDto`, `text`), здесь второй trim был бы мёртвой веткой.
 */
function nonEmptyOnly(requisites: OrgRequisites): Partial<OrgRequisites> {
  const patch: Partial<OrgRequisites> = {};
  for (const key of ORG_REQUISITE_KEYS) {
    const value = requisites[key];
    if (value !== null) patch[key] = value;
  }
  return patch;
}

/** Все реквизиты как есть — для `create`, где затирать ещё нечего. */
function allRequisites(requisites: OrgRequisites): OrgRequisites {
  const out = {} as OrgRequisites;
  for (const key of ORG_REQUISITE_KEYS) out[key] = requisites[key];
  return out;
}

export async function upsertOrgRecord(
  db: PrismaClient,
  dto: OneCOrgDto,
  sum: BatchSummary,
  ctx: WriteCtx
): Promise<WriteOutcome | undefined> {
  const input = mapOrgDto(dto);
  // Т-19 (решение владельца №1): партнёр необязателен — пустая ссылка означает
  // ПРЯМОГО клиента (partnerId: null), а не брак строки. Прежний код
  // no_partner_external_id удалён полностью.
  const rawPartnerRef = input.partnerExternalId?.trim() || null;
  let partnerId: string | null = null;
  if (rawPartnerRef) {
    // Т-20: в файловой колонке лежит ИНН, а сетевой adapter-rest шлёт настоящий
    // slug — поэтому ИНН И slug ищутся одним OR, иначе этап сломал бы работающую
    // сетевую синхронизацию. Partner.inn @unique — коллизий OR не даёт.
    const partner = await db.partner.findFirst({
      where: { OR: [{ inn: normalizeInn(rawPartnerRef) }, { slug: rawPartnerRef }] },
      select: { id: true },
    });
    if (!partner) {
      // Указан, но не найден — не угадываем и не создаём партнёра молча.
      sum.skipped += 1;
      sum.skips.push({ externalId: input.externalId, reason: 'partner_not_found' });
      return;
    }
    partnerId = partner.id;
  }
  // Resolve by externalId OR inn (Organization.inn is @unique). Matching only by
  // externalId would push an org that already exists under its INN (xlsx import or
  // order-backfill) into the create branch and throw P2002 on inn every run. Mirrors
  // resolveOrganizationRef's externalId→inn fallback used by the order/payment writers.
  // name/inn/kpp/partnerId в select — снимок «до» для истории импорта (Т-33).
  const existingSelect = {
    id: true,
    companyId: true,
    externalId: true,
    name: true,
    inn: true,
    kpp: true,
    partnerId: true,
  } as const;
  let existing = await db.organization.findUnique({
    where: { externalId: input.externalId },
    select: existingSelect,
  });
  if (!existing && input.inn) {
    existing = await db.organization.findFirst({
      where: { inn: input.inn },
      select: existingSelect,
    });
  }
  if (existing) {
    // C8: floor the update on the matched org's OWN company (mirrors the order/
    // payment writers). A scoped actor may only mutate orgs inside its scope.
    if (!orgInScope(ctx.scope, { id: existing.id, companyId: existing.companyId })) {
      sum.skipped += 1;
      sum.skips.push({ externalId: input.externalId, reason: 'out_of_scope' });
      return undefined;
    }
    if (isLive(ctx)) {
      // Backfill the 1C externalId only when the matched org has none — never clobber a different identity.
      // `У-84`: имя приходит из 1С — ключ названия пересчитывается вместе с ним.
      // `У-171`: реквизиты — только непустые (см. `nonEmptyOnly`).
      const nameKey = organizationNameKey(input.name);
      const data = {
        name: input.name,
        nameKey,
        ...nonEmptyOnly(input),
        ...(input.externalId && !existing.externalId ? { externalId: input.externalId } : {}),
      };
      await db.organization.update({ where: { id: existing.id }, data });
    }
    sum.updated += 1;
    ctx.bump?.(dto.updatedAt);
    if (!isLive(ctx)) return undefined;
    return {
      entityId: existing.id,
      action: 'updated',
      before: {
        name: existing.name,
        inn: existing.inn,
        kpp: existing.kpp,
        externalId: existing.externalId,
        partnerId: existing.partnerId,
      },
    };
  } else {
    if (!mayCreateOrg(ctx.scope)) {
      sum.skipped += 1;
      sum.skips.push({ externalId: input.externalId, reason: 'out_of_scope' });
      return;
    }
    // Т-41: организация создаётся в СУЩЕСТВУЮЩЕЙ компании — минт Company на
    // каждого контрагента удалён (дефект §0.2). Скоуп `company` побеждает
    // всегда: руководитель создаёт строго в своей компании (C8), подсунуть
    // чужую через createCompanyId нельзя.
    const companyId =
      ctx.scope?.kind === 'company' ? ctx.scope.companyId : (ctx.createCompanyId ?? null);
    if (!companyId) {
      sum.failed += 1;
      sum.failures.push({ externalId: input.externalId, error: 'company_not_configured' });
      return;
    }
    let createdId: string | undefined;
    if (isLive(ctx)) {
      const created = await db.organization.create({
        data: {
          externalId: input.externalId,
          name: input.name,
          // `У-84`: ключ названия — при каждом создании.
          nameKey: organizationNameKey(input.name),
          // `У-171`: при создании реквизиты пишутся как есть — затирать нечего.
          ...allRequisites(input),
          partnerId,
          companyId,
        },
        select: { id: true },
      });
      createdId = created.id;
    }
    sum.created += 1;
    ctx.bump?.(dto.updatedAt);
    return createdId ? { entityId: createdId, action: 'created' } : undefined;
  }
}

/**
 * `У-170`: поиск входящего документа по трём ключам, строго по порядку.
 *
 * 1. `externalId` — документ, который 1С уже присылала (её собственный id).
 * 2. `oneCExternalId` — документ, который МЫ выгрузили (`У-168`): 1С вернула
 *    его под своим id, и он же лежит у нас в `oneCExternalId`. Все версии
 *    цепочки перевыпусков делят этот id — берём действующую.
 * 3. `type + number` в пределах заказа — 1С выпустила бумагу с нашим
 *    номером, но id мы ещё не знаем (например, выгрузили файловым каналом).
 *
 * Без ключей 2 и 3 подписанный в 1С договор возвращался вторым документом
 * (`Д-24`). Один `findFirst` с `OR` порядок не удержит — поэтому три запроса.
 */
const INBOUND_MATCH_SELECT = {
  id: true,
  externalId: true,
  type: true,
  status: true,
  number: true,
  version: true,
  mimeType: true,
  size: true,
  signedAt: true,
  uploadedById: true,
  sentById: true,
} as const;

async function findInboundDocumentMatch(
  db: PrismaClient,
  input: DocumentUpsertInput,
  orderId: string
) {
  const byExternalId = await db.document.findUnique({
    where: { externalId: input.externalId },
    select: INBOUND_MATCH_SELECT,
  });
  if (byExternalId) return byExternalId;
  const byOneCId = await db.document.findFirst({
    where: { oneCExternalId: input.externalId, supersededAt: null },
    orderBy: { version: 'desc' },
    select: INBOUND_MATCH_SELECT,
  });
  if (byOneCId) return byOneCId;
  if (!input.number) return null;
  return db.document.findFirst({
    where: { orderId, type: input.type, number: input.number, supersededAt: null },
    orderBy: { version: 'desc' },
    select: INBOUND_MATCH_SELECT,
  });
}

/**
 * Частичный уникальный индекс `(companyId, type, number, version)` (`У-151`)
 * не даст записать номер, который у компании уже занят другой бумагой.
 * Такое бывает при расхождении нумерации 1С и кабинета; ронять запись
 * из-за метаданных нельзя — документ приезжает без номера, а в лог уходит
 * предупреждение.
 */
async function numberIsFree(
  db: PrismaClient,
  args: { companyId: string; type: DocumentType; number: string; version: number }
): Promise<boolean> {
  const taken = await db.document.findFirst({ where: args, select: { id: true } });
  return !taken;
}

/**
 * Скан ClamAV — best-effort, как у комиссионных PDF/XLSX: без Redis (тесты,
 * частичный dev) молча пропускается, сбой очереди не роняет запись.
 */
async function enqueueDocumentScan(documentId: string) {
  if (!process.env.REDIS_URL) return;
  try {
    const payload: ScanDocumentPayload = { kind: 'document', id: documentId };
    await getQueue('docs.scanDocument').add('scan', payload);
  } catch (err) {
    log.warn('[1c] document scan enqueue failed', err);
  }
}

/**
 * `У-170`: 1С сообщила, что бумага подписана, — документ переходит в
 * «принят» через единственную дверь статусов (`У-148`), а не прямым
 * `update`. Дверь сама решает, есть ли у типа жизненный цикл и разрешён ли
 * переход; автором записи в журнале становится тот, кто выпустил документ
 * (у фоновой задачи своей сессии нет — приём из `expire-proposals`).
 */
async function acceptSignedFromOneC(
  db: PrismaClient,
  doc: { id: string; status: string; uploadedById: string | null; sentById: string | null }
) {
  if (doc.status !== 'issued' && doc.status !== 'sent') return;
  const actorId = doc.uploadedById ?? doc.sentById;
  if (!actorId) {
    // Некому приписать действие — статус остаётся, подпись (`signedAt`) уже
    // записана. Человек переведёт бумагу руками.
    log.info('[1c] signed document has no actor, status unchanged', { documentId: doc.id });
    return;
  }
  const actor = { sub: actorId } as unknown as SessionPayload;
  try {
    const res = await setDocumentStatus(db, actor, { documentId: doc.id, to: 'accepted' });
    if (!res.ok && res.error !== 'not_lifecycle_type') {
      log.warn('[1c] signed document status door refused', {
        documentId: doc.id,
        error: res.error,
      });
    }
  } catch (err) {
    log.warn('[1c] signed document status change failed', { documentId: doc.id, err });
  }
}

export async function upsertDocumentRecord(
  db: PrismaClient,
  dto: OneCDocumentDto,
  sum: BatchSummary,
  ctx: WriteCtx
) {
  const input = mapDocumentDto(dto);
  const order = await db.order.findUnique({
    where: { externalId: input.orderExternalId },
    select: { id: true, organizationId: true, companyId: true, orderNumber: true, title: true },
  });
  if (!order) {
    sum.skipped += 1;
    sum.skips.push({ externalId: input.externalId, reason: 'order_not_found' });
    return;
  }
  // C8: floor the document on its order's OWN company (Order.companyId is required),
  // so a company-scoped leader cannot attach a doc to another company's order.
  // Mirrors upsertPaymentRecord's order-linked branch.
  if (!orgInScope(ctx.scope, { id: order.organizationId, companyId: order.companyId })) {
    sum.skipped += 1;
    sum.skips.push({ externalId: input.externalId, reason: 'out_of_scope' });
    return;
  }
  const existing = await findInboundDocumentMatch(db, input, order.id);
  if (existing) {
    // `Д-24`: файл в 1С изменился — другой размер или тип, либо появилась
    // (сменилась) подпись: подписанный скан — другой файл. Он забирается
    // заново и идёт на повторный скан: файл из чужой системы непроверенным
    // считаться не может.
    const fileChanged =
      existing.size !== input.size ||
      existing.mimeType !== input.mimeType ||
      (input.signedAt !== null && existing.signedAt?.getTime() !== input.signedAt.getTime());
    let storagePath: string | null = null;
    if (fileChanged && isLive(ctx)) {
      storagePath = await fetchAndStore1CDocument({
        url: input.downloadUrl,
        orderId: order.id,
        name: input.name,
        mimeType: input.mimeType,
      });
      if (!storagePath) {
        sum.skipped += 1;
        sum.skips.push({ externalId: input.externalId, reason: 'document_fetch_failed' });
        return;
      }
    }
    if (isLive(ctx)) {
      // Бумагу, которую 1С прислала сама, она и описывает: имя и тип — её.
      // Нашему документу (ключи 2 и 3) 1С не хозяин: его имя и тип не трогаем,
      // пока не поменялся сам файл.
      const ownedBy1C = existing.externalId === input.externalId;
      const fillNumber =
        existing.number === null &&
        input.number !== null &&
        (await numberIsFree(db, {
          companyId: order.companyId,
          type: existing.type,
          number: input.number,
          version: existing.version,
        }));
      if (existing.number === null && input.number !== null && !fillNumber) {
        log.warn('[1c] document number already taken, kept empty', {
          documentId: existing.id,
          number: input.number,
        });
      }
      await db.document.update({
        where: { id: existing.id },
        data: {
          // Пустое из 1С не стирает подпись, которая у нас уже есть.
          signedAt: input.signedAt ?? existing.signedAt,
          oneCExternalId: input.externalId,
          ...(ownedBy1C ? { name: input.name, type: input.type } : {}),
          ...(fillNumber ? { number: input.number } : {}),
          ...(storagePath
            ? {
                name: input.name,
                mimeType: input.mimeType,
                size: input.size,
                path: storagePath,
                scanStatus: 'pending',
                scanReason: null,
                scannedAt: null,
              }
            : {}),
        },
      });
      if (storagePath) await enqueueDocumentScan(existing.id);
      if (input.signedAt) await acceptSignedFromOneC(db, existing);
    }
    sum.updated += 1;
    ctx.bump?.(dto.updatedAt);
    return;
  }

  if (isLive(ctx)) {
    // DOC-03: fetch the 1C file into object storage so `path` is a bucket key (not the
    // external URL) — download routes + ClamAV scan work unchanged. Fetch failure
    // skips the doc with a visible reason instead of crashing the batch (§3).
    const storagePath = await fetchAndStore1CDocument({
      url: input.downloadUrl,
      orderId: order.id,
      name: input.name,
      mimeType: input.mimeType,
    });
    if (!storagePath) {
      sum.skipped += 1;
      sum.skips.push({ externalId: input.externalId, reason: 'document_fetch_failed' });
      return;
    }
    const number =
      input.number !== null &&
      (await numberIsFree(db, {
        companyId: order.companyId,
        type: input.type,
        number: input.number,
        version: 1,
      }))
        ? input.number
        : null;
    if (input.number !== null && number === null) {
      log.warn('[1c] document number already taken, created without it', {
        externalId: input.externalId,
        number: input.number,
      });
    }
    const created = await db.document.create({
      data: {
        name: input.name,
        mimeType: input.mimeType,
        size: input.size,
        type: input.type,
        signedAt: input.signedAt,
        number,
        path: storagePath,
        scanStatus: 'pending',
        externalId: input.externalId,
        oneCExternalId: input.externalId,
        orderId: order.id,
        // `У-151`: компания-исполнитель есть у каждого документа; у документа
        // заказа она берётся из заказа и совпадать с ним обязана (составной
        // внешний ключ этого не даст нарушить).
        companyId: order.companyId,
        // `У-170` (`Д-25`): направление — из DTO, а не литералом.
        direction: input.direction,
        generatedBy: 'system',
        counterpartyType: 'organization',
        counterpartyId: order.organizationId,
      },
      select: { id: true },
    });
    if (created?.id) await enqueueDocumentScan(created.id);
  }
  sum.created += 1;
  ctx.bump?.(dto.updatedAt);
  if (ctx.notify && isLive(ctx) && order.organizationId) {
    try {
      await notifyOrgUsers(db, {
        organizationId: order.organizationId,
        type: 'document_published',
        payload: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderTitle: order.title,
          documentName: input.name,
          documentType: input.type,
        },
      });
    } catch (err) {
      log.warn('[1c] document notifyOrgUsers failed', err);
    }
  }
}
