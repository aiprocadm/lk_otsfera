import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';

// Redis и S3 — моки, «1С» — подставной адаптер с переключаемым ответом на
// «есть ли документ» (фейковая 1С отвечает «есть» всегда — см. adapter-fake),
// Postgres — живой: пометка `failed`, цепочка перевыпусков, строки истории и
// уведомления партнёру живут в реальных таблицах.
const { queueAdd, getQueue, findDocument, createSignedUrl } = vi.hoisted(() => {
  const queueAdd = vi.fn();
  return {
    queueAdd,
    getQueue: vi.fn(() => ({ add: queueAdd })),
    findDocument: vi.fn(),
    createSignedUrl: vi.fn(async (path: string) => `https://s3.test/${path}`),
  };
});
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ createSignedUrl }) }));
vi.mock('@/lib/services/oneCSync/index', () => ({
  getOneCAdapter: () => ({ findDocument }),
}));

import { syncReconcileProcessor } from '@/worker/processors/sync-reconcile';
import type { SyncJobPayload } from '@/lib/jobs/types';

/**
 * Этап 8, PR-8 (`У-172`, `Д-26`) — сверка на живом Postgres. Страж полноты
 * `worker.processor-coverage` требует, чтобы процессор
 * `worker/processors/sync-reconcile` был покрыт именно здесь.
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyId: string;
let orgId: string;
let managerId: string;
let orderId: string;
let partnerId: string;
let partnerAdminId: string;
const createdDocIds: string[] = [];
const createdLeadIds: string[] = [];
const HOURS = 60 * 60 * 1000;

function job(): Job<SyncJobPayload> {
  return {
    id: `test-reconcile-${Date.now()}`,
    data: { triggeredAt: new Date().toISOString(), reason: 'cron' },
  } as Job<SyncJobPayload>;
}

type DocOverrides = Parameters<PrismaClient['document']['create']>[0]['data'];

async function createDoc(overrides: Partial<DocOverrides> = {}): Promise<string> {
  const n = createdDocIds.length + 1;
  const doc = await prisma.document.create({
    data: {
      name: `s8p8-${STAMP}-${n}.pdf`,
      path: `documents/s8p8-${STAMP}-${n}.pdf`,
      mimeType: 'application/pdf',
      type: 'invoice',
      direction: 'outgoing',
      number: `С-2026-${n}`,
      companyId,
      orderId,
      counterpartyType: 'organization',
      counterpartyId: orgId,
      uploadedById: managerId,
      generatedBy: 'system',
      scanStatus: 'clean',
      oneCPushStatus: 'pushed',
      oneCExternalId: `1c-doc-s8p8-${n}`,
      oneCPushedAt: new Date(),
      oneCPushedVersion: 1,
      ...overrides,
    } as DocOverrides,
    select: { id: true },
  });
  createdDocIds.push(doc.id);
  return doc.id;
}

async function createLead(pushedToOneCAt: Date | null): Promise<string> {
  const lead = await prisma.lead.create({
    data: {
      partnerId,
      createdByUserId: managerId,
      clientCompanyName: `ООО Клиент ${STAMP}`,
      clientContactName: 'Иван Иванов',
      subject: 'Запрос на обучение',
      productType: ['course'],
      pushedToOneCAt,
    },
    select: { id: true },
  });
  createdLeadIds.push(lead.id);
  return lead.id;
}

const readPush = (id: string) =>
  prisma.document.findUniqueOrThrow({
    where: { id },
    select: { oneCPushStatus: true, oneCPushError: true, oneCPushAttempts: true },
  });

const leadLogs = (id: string) =>
  prisma.syncLog.findMany({
    where: { entity: 'lead', externalId: id },
    orderBy: { createdAt: 'asc' },
    select: { operation: true, status: true, errorMessage: true, payload: true },
  });

beforeAll(async () => {
  prisma = new PrismaClient();
  companyId = (await prisma.company.create({ data: { name: `s8p8-${STAMP}` } })).id;
  orgId = (
    await prisma.organization.create({
      data: { name: `s8p8-org-${STAMP}`, inn: `78${String(STAMP).slice(-8)}`, companyId },
    })
  ).id;
  managerId = (
    await prisma.user.create({
      data: { email: `s8p8-m-${STAMP}@t.local`, name: 'М', role: 'manager', companyId },
    })
  ).id;
  orderId = (
    await prisma.order.create({
      data: {
        title: `s8p8-o-${STAMP}`,
        orderNumber: `З-${STAMP}`,
        companyId,
        organizationId: orgId,
        managerId,
        totalAmount: 18000,
      },
    })
  ).id;
  partnerId = (
    await prisma.partner.create({
      data: { name: `s8p8-partner-${STAMP}`, slug: `s8p8-partner-${STAMP}`, commissionRate: 0.1 },
    })
  ).id;
  partnerAdminId = (
    await prisma.user.create({
      data: { email: `s8p8-pa-${STAMP}@t.local`, name: 'ПА', role: 'partner', partnerId },
    })
  ).id;
  await prisma.partnerUser.create({
    data: { partnerId, userId: partnerAdminId, roleInPartner: 'admin', assignedOrgIds: [] },
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  getQueue.mockImplementation(() => ({ add: queueAdd }));
  findDocument.mockImplementation(async (externalId: string) => ({ externalId }));
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { partnerId } });
  await prisma.document.updateMany({
    where: { id: { in: createdDocIds } },
    data: { replacesDocumentId: null },
  });
  await prisma.document.deleteMany({ where: { id: { in: createdDocIds } } });
  await prisma.syncLog.deleteMany({
    where: { externalId: { in: [...createdDocIds, ...createdLeadIds, `fake-req-${STAMP}`] } },
  });
  await prisma.lead.deleteMany({ where: { id: { in: createdLeadIds } } });
  await prisma.partnerUser.deleteMany({ where: { partnerId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [managerId, partnerAdminId] } } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('syncReconcileProcessor — документы (`У-172`)', () => {
  it('пропавший в 1С → failed с русской причиной и error в истории; найденный остаётся pushed', async () => {
    const okId = await createDoc();
    const lostId = await createDoc();
    findDocument.mockImplementation(async (externalId: string) =>
      externalId === lostId ? null : { externalId }
    );

    const result = await syncReconcileProcessor(job(), prisma);

    expect(result.documents.missing).toContain(lostId);
    expect(result.documents.missing).not.toContain(okId);
    expect(result.documents.error).toBeNull();
    expect(await readPush(okId)).toMatchObject({ oneCPushStatus: 'pushed', oneCPushError: null });
    // Попытки не считаем: сверка — не попытка выгрузки, а её проверка.
    expect(await readPush(lostId)).toEqual({
      oneCPushStatus: 'failed',
      oneCPushError: 'Документ не найден в 1С при сверке — выгрузите его заново.',
      oneCPushAttempts: 0,
    });
    const rows = await prisma.syncLog.findMany({
      where: { entity: 'document', externalId: lostId },
      select: { direction: true, operation: true, status: true, errorMessage: true },
    });
    expect(rows).toEqual([
      { direction: 'outbound', operation: 'check', status: 'error', errorMessage: 'missing_in_1c' },
    ]);
    // Итог прохода по документам — своя строка `reconcile`/outbound.
    const summary = await prisma.syncLog.findFirst({
      where: { entity: 'reconcile', direction: 'outbound' },
      orderBy: { createdAt: 'desc' },
      select: { status: true, payload: true },
    });
    expect(summary?.status).toBe('warn');
    expect((summary?.payload as { missing: string[] }).missing).toContain(lostId);
  });

  it('перевыпущенная версия спрашивается по корню цепочки; заменённая не спрашивается', async () => {
    const rootId = await createDoc({ oneCPushStatus: 'pushed', supersededAt: new Date() });
    const v2Id = await createDoc({ replacesDocumentId: rootId, version: 2, oneCPushedVersion: 2 });

    await syncReconcileProcessor(job(), prisma);

    const asked = findDocument.mock.calls.map((c) => c[0] as string);
    // v2 спрашивается под id корня — под ним бумага и уехала в 1С.
    expect(asked).toContain(rootId);
    expect(asked).not.toContain(v2Id);
    // Сам корень (заменённая версия) в выборку не попал: rootId спрошен ровно один раз — за v2.
    expect(asked.filter((id) => id === rootId)).toHaveLength(1);
    expect((await readPush(v2Id)).oneCPushStatus).toBe('pushed');
  });

  it('ошибка транспорта: ничего не помечается, итог error, остальные — unchecked', async () => {
    const id = await createDoc();
    findDocument.mockRejectedValue(new Error('1C responded 503'));

    const result = await syncReconcileProcessor(job(), prisma);

    expect(result.documents).toMatchObject({ checked: 0, missing: [], error: '1C responded 503' });
    expect(result.documents.unchecked).toBeGreaterThan(0);
    expect((await readPush(id)).oneCPushStatus).toBe('pushed');
    const summary = await prisma.syncLog.findFirst({
      where: { entity: 'reconcile', direction: 'outbound' },
      orderBy: { createdAt: 'desc' },
      select: { status: true, errorMessage: true },
    });
    expect(summary).toEqual({ status: 'error', errorMessage: '1C responded 503' });
  });
});

describe('syncReconcileProcessor — зависшие лиды (`Д-26`)', () => {
  it('претензия старше суток без подтверждения: снимается, лид в очереди, warn в истории', async () => {
    const leadId = await createLead(new Date(Date.now() - 30 * HOURS));
    const freshId = await createLead(new Date(Date.now() - 2 * HOURS));

    const result = await syncReconcileProcessor(job(), prisma);

    expect(result.leads.requeued).toContain(leadId);
    expect(result.leads.requeued).not.toContain(freshId);
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { pushedToOneCAt: true },
    });
    expect(lead.pushedToOneCAt).toBeNull();
    expect(queueAdd).toHaveBeenCalledWith(
      'push',
      { leadId },
      { jobId: expect.stringMatching(/^push-lead:/) }
    );
    expect(await leadLogs(leadId)).toEqual([
      expect.objectContaining({ operation: 'check', status: 'warn', errorMessage: null }),
    ]);
  });

  it('лид, принятый 1С без её номера (success в истории), не трогается', async () => {
    const leadId = await createLead(new Date(Date.now() - 30 * HOURS));
    await prisma.syncLog.create({
      data: {
        entity: 'lead',
        direction: 'outbound',
        operation: 'create',
        status: 'success',
        externalId: `fake-req-${STAMP}`,
        payload: { cabinetLeadId: leadId, acceptedAt: new Date().toISOString() },
      },
    });

    const result = await syncReconcileProcessor(job(), prisma);

    expect(result.leads.requeued).not.toContain(leadId);
    expect(result.leads.stuck).not.toContain(leadId);
    expect(queueAdd).not.toHaveBeenCalledWith('push', { leadId }, expect.anything());
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { pushedToOneCAt: true },
    });
    expect(lead.pushedToOneCAt).not.toBeNull();
  });

  it('второй раз подряд: error в истории, претензия остаётся, партнёру уходит уведомление', async () => {
    const leadId = await createLead(new Date(Date.now() - 30 * HOURS));
    // Первый прогон — повтор (warn); имитируем, что повтор снова застрял.
    await syncReconcileProcessor(job(), prisma);
    await prisma.lead.update({
      where: { id: leadId },
      data: { pushedToOneCAt: new Date(Date.now() - 26 * HOURS) },
    });
    vi.clearAllMocks();
    getQueue.mockImplementation(() => ({ add: queueAdd }));
    findDocument.mockImplementation(async (externalId: string) => ({ externalId }));

    const result = await syncReconcileProcessor(job(), prisma);

    expect(result.leads.stuck).toContain(leadId);
    expect(queueAdd).not.toHaveBeenCalledWith('push', { leadId }, expect.anything());
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { pushedToOneCAt: true },
    });
    expect(lead.pushedToOneCAt).not.toBeNull();
    expect((await leadLogs(leadId)).map((r) => [r.operation, r.status, r.errorMessage])).toEqual([
      ['check', 'warn', null],
      ['check', 'error', 'lead_stuck_in_push'],
    ]);
    const notice = await prisma.notification.findFirst({
      where: { partnerId, userId: partnerAdminId, type: 'sync_error' },
      orderBy: { createdAt: 'desc' },
      select: { title: true, body: true, meta: true },
    });
    expect(notice?.title).toBe('Не удалось отправить заявку в 1С');
    expect(notice?.body).toContain('повтор при сверке не помог');
    expect(notice?.meta).toMatchObject({ kind: 'push_lead_failed', leadId });
  });
});
