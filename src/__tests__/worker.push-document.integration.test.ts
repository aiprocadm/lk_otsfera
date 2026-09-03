import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';

// S3 и Redis — моки (ссылку выписываем, задачу «кладём»), Postgres — живой:
// идемпотентность по версии и цепочка перевыпусков живут в реальных строках.
const { createSignedUrl, queueAdd, getQueue } = vi.hoisted(() => {
  const queueAdd = vi.fn();
  return {
    createSignedUrl: vi.fn(async (path: string, ttl: number) => `https://s3.test/${path}?ttl=${ttl}`),
    queueAdd,
    getQueue: vi.fn(() => ({ add: queueAdd })),
  };
});
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ createSignedUrl }) }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

import { pushDocumentProcessor } from '@/worker/processors/push-document';
import {
  pushDocumentToOneC,
  enqueueDocumentPush,
  ONE_C_FILE_URL_TTL_SECONDS,
} from '@/lib/services/oneCSync/pushDocument';
import { resetOneCAdapter, type OneCAdapter } from '@/lib/services/oneCSync';
import type { OneCDocumentPushPayload } from '@/lib/services/oneCSync/dto';
import type { PushDocumentJobPayload } from '@/lib/jobs/types';
import { log } from '@/lib/logging';

/**
 * Этап 8, PR-3 (`У-168`, `У-167`, `У-159`) — выгрузка документа в 1С на живом
 * Postgres. Страж полноты `worker.processor-coverage` требует, чтобы процессор
 * `worker/processors/push-document` был покрыт именно здесь.
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyId: string;
let orgId: string;
let orgNoInnId: string;
let managerId: string;
let orderId: string;
const createdDocIds: string[] = [];

/** Подставной адаптер: запоминает тела и отвечает как 1С по контракту. */
function fakeAdapter(impl?: (p: OneCDocumentPushPayload) => Promise<{ externalId: string }>) {
  const pushDocument = vi.fn(
    impl ?? (async (p: OneCDocumentPushPayload) => ({ externalId: `1c-doc-${p.externalId}` }))
  );
  return { adapter: { pushDocument } as unknown as OneCAdapter, pushDocument };
}

type DocOverrides = Parameters<PrismaClient['document']['create']>[0]['data'];

async function createDoc(overrides: Partial<DocOverrides> = {}, withLine = true): Promise<string> {
  const doc = await prisma.document.create({
    data: {
      name: `s8p3-${STAMP}.pdf`,
      path: `documents/s8p3-${STAMP}-${createdDocIds.length}.pdf`,
      mimeType: 'application/pdf',
      type: 'invoice',
      direction: 'outgoing',
      number: `С-2026-${createdDocIds.length + 1}`,
      companyId,
      orderId,
      counterpartyType: 'organization',
      counterpartyId: orgId,
      uploadedById: managerId,
      generatedBy: 'system',
      scanStatus: 'clean',
      amountNet: 15000,
      amountVat: 3000,
      amountGross: 18000,
      currency: 'RUB',
      ...(withLine
        ? {
            lines: {
              create: {
                title: 'Обучение по охране труда, 40 ч',
                quantity: 3,
                unit: 'person',
                unitPrice: 5000,
                vatRate: 0.2,
                vatAmount: 3000,
                amount: 18000,
              },
            },
          }
        : {}),
      ...overrides,
    } as DocOverrides,
    select: { id: true },
  });
  createdDocIds.push(doc.id);
  return doc.id;
}

const PUSH_FIELDS = {
  oneCPushStatus: true,
  oneCExternalId: true,
  oneCPushedAt: true,
  oneCPushAttempts: true,
  oneCPushError: true,
  oneCPushedVersion: true,
} as const;

const readPush = (id: string) =>
  prisma.document.findUniqueOrThrow({ where: { id }, select: PUSH_FIELDS });

function job(data: PushDocumentJobPayload): Job<PushDocumentJobPayload> {
  return { id: `test-pushdoc-${Date.now()}`, data } as Job<PushDocumentJobPayload>;
}

beforeAll(async () => {
  process.env.ONE_C_ADAPTER = 'fake';
  delete process.env.FAKE_ONEC_FAILURE_RATE;
  resetOneCAdapter();
  prisma = new PrismaClient();

  companyId = (await prisma.company.create({ data: { name: `s8p3-${STAMP}` } })).id;
  orgId = (
    await prisma.organization.create({
      data: {
        name: `s8p3-org-${STAMP}`,
        legalName: `ООО Ромашка ${STAMP}`,
        inn: `77${String(STAMP).slice(-8)}`,
        kpp: '770101001',
        companyId,
      },
    })
  ).id;
  // `Р-11`: организация из выписки может жить без ИНН — 1С такую не примет.
  orgNoInnId = (
    await prisma.organization.create({ data: { name: `s8p3-noinn-${STAMP}`, companyId } })
  ).id;
  managerId = (
    await prisma.user.create({
      data: { email: `s8p3-m-${STAMP}@t.local`, name: 'М', role: 'manager', companyId },
    })
  ).id;
  orderId = (
    await prisma.order.create({
      data: {
        title: `s8p3-o-${STAMP}`,
        orderNumber: `З-${STAMP}`,
        externalId: `1c-order-s8p3-${STAMP}`,
        companyId,
        organizationId: orgId,
        managerId,
        totalAmount: 18000,
      },
    })
  ).id;
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FAKE_ONEC_FAILURE_RATE;
  resetOneCAdapter();
});

afterAll(async () => {
  await prisma.documentLine.deleteMany({ where: { documentId: { in: createdDocIds } } });
  await prisma.document.updateMany({
    where: { id: { in: createdDocIds } },
    data: { parentDocumentId: null, replacesDocumentId: null },
  });
  await prisma.document.deleteMany({ where: { id: { in: createdDocIds } } });
  await prisma.syncLog.deleteMany({ where: { entity: 'document', externalId: { in: createdDocIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: managerId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, orgNoInnId] } } });
  await prisma.user.deleteMany({ where: { id: managerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
  resetOneCAdapter();
});

describe('pushDocumentToOneC — тело по контракту и шесть полей (`У-167`, `У-168`)', () => {
  it('выгрузка заполняет шесть полей, тело собрано по контракту, ссылка живёт час', async () => {
    const id = await createDoc();
    const { adapter, pushDocument } = fakeAdapter();

    const res = await pushDocumentToOneC(prisma, id, { adapter, actorUserId: managerId });
    expect(res).toEqual({ ok: true, oneCExternalId: `1c-doc-${id}`, skipped: null });

    const body = pushDocument.mock.calls[0][0] as OneCDocumentPushPayload;
    expect(body).toMatchObject({
      externalId: id,
      type: 'invoice',
      number: 'С-2026-1',
      version: 1,
      counterparty: {
        inn: `77${String(STAMP).slice(-8)}`,
        kpp: '770101001',
        name: `s8p3-org-${STAMP}`,
        legalName: `ООО Ромашка ${STAMP}`,
      },
      order: { externalId: `1c-order-s8p3-${STAMP}`, orderNumber: `З-${STAMP}` },
      parentDocument: null,
      lines: [
        {
          title: 'Обучение по охране труда, 40 ч',
          quantity: 3,
          unit: 'чел.',
          price: 5000,
          vatRate: 0.2,
          vatAmount: 3000,
          amount: 18000,
        },
      ],
      totals: { net: 15000, vat: 3000, gross: 18000 },
    });
    expect(Date.parse(body.date)).not.toBeNaN();
    expect(createSignedUrl).toHaveBeenCalledWith(expect.stringMatching(/^documents\//), 3600);
    expect(ONE_C_FILE_URL_TTL_SECONDS).toBe(3600);
    expect(body.fileUrl).toContain('?ttl=3600');

    const after = await readPush(id);
    expect(after).toMatchObject({
      oneCPushStatus: 'pushed',
      oneCExternalId: `1c-doc-${id}`,
      oneCPushAttempts: 1,
      oneCPushError: null,
      oneCPushedVersion: 1,
    });
    expect(after.oneCPushedAt).toBeInstanceOf(Date);

    // `У-159`: событие журнала от имени того, кто попросил выгрузку.
    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'document', entityId: id, action: 'document_pushed_to_1c' },
    });
    expect(audit?.userId).toBe(managerId);
    // История попыток (`У-174`): первая выгрузка цепочки — `create`.
    const sync = await prisma.syncLog.findFirst({
      where: { entity: 'document', externalId: id, direction: 'outbound' },
    });
    expect(sync).toMatchObject({ operation: 'create', status: 'success' });
  });

  it('вторая задача той же версии — адаптер не вызван, поля не тронуты (спека 3.1)', async () => {
    const id = await createDoc();
    const first = fakeAdapter();
    await pushDocumentToOneC(prisma, id, { adapter: first.adapter });
    const before = await readPush(id);

    const second = fakeAdapter();
    const res = await pushDocumentToOneC(prisma, id, { adapter: second.adapter });
    expect(res).toEqual({ ok: true, oneCExternalId: `1c-doc-${id}`, skipped: 'same_version' });
    expect(second.pushDocument).not.toHaveBeenCalled();
    expect(await readPush(id)).toEqual(before);
  });

  it('перевыпуск уезжает с тем же externalId (корень цепочки) и version + 1 — операция update', async () => {
    const rootId = await createDoc();
    const { adapter, pushDocument } = fakeAdapter();
    await pushDocumentToOneC(prisma, rootId, { adapter });

    // `У-151`: новая версия — новая строка, старая помечена заменённой.
    await prisma.document.update({ where: { id: rootId }, data: { supersededAt: new Date() } });
    const v2 = await createDoc({ number: 'С-2026-1', version: 2, replacesDocumentId: rootId });
    const v3 = await createDoc({ number: 'С-2026-1', version: 3, replacesDocumentId: v2 });
    await prisma.document.update({ where: { id: v2 }, data: { supersededAt: new Date() } });

    const res = await pushDocumentToOneC(prisma, v3, { adapter });
    expect(res).toEqual({ ok: true, oneCExternalId: `1c-doc-${rootId}`, skipped: null });
    const body = pushDocument.mock.calls[1][0] as OneCDocumentPushPayload;
    expect(body.externalId).toBe(rootId);
    expect(body.version).toBe(3);
    expect(await readPush(v3)).toMatchObject({ oneCPushStatus: 'pushed', oneCPushedVersion: 3 });
    const sync = await prisma.syncLog.findFirst({
      where: { entity: 'document', externalId: v3, direction: 'outbound' },
    });
    expect(sync?.operation).toBe('update');

    // Заменённая версия сама больше не уезжает.
    const stale = await pushDocumentToOneC(prisma, v2, { adapter });
    expect(stale).toEqual({ ok: false, error: 'superseded' });
    expect(pushDocument).toHaveBeenCalledTimes(2);
  });

  it('основание уезжает корнем своей цепочки и номером', async () => {
    const invoice = await createDoc({ number: 'С-2026-9' });
    const act = await createDoc({ type: 'act', number: 'А-2026-9', parentDocumentId: invoice });
    const { adapter, pushDocument } = fakeAdapter();
    await pushDocumentToOneC(prisma, act, { adapter });
    const body = pushDocument.mock.calls[0][0] as OneCDocumentPushPayload;
    expect(body.parentDocument).toEqual({ externalId: invoice, number: 'С-2026-9' });
  });

  it('КП — not_pushable_type, адаптер не вызван, поля не тронуты (`Р-14`)', async () => {
    const id = await createDoc({ type: 'commercial_proposal', number: 'КП-2026-1' });
    const { adapter, pushDocument } = fakeAdapter();
    const res = await pushDocumentToOneC(prisma, id, { adapter });
    expect(res).toEqual({ ok: false, error: 'not_pushable_type' });
    expect(pushDocument).not.toHaveBeenCalled();
    expect(await readPush(id)).toEqual({
      oneCPushStatus: 'none',
      oneCExternalId: null,
      oneCPushedAt: null,
      oneCPushAttempts: 0,
      oneCPushError: null,
      oneCPushedVersion: null,
    });
  });

  it('КП, успевшее встать в очередь, возвращается из pending в none', async () => {
    const id = await createDoc({ type: 'commercial_proposal', oneCPushStatus: 'pending' });
    await pushDocumentToOneC(prisma, id, { adapter: fakeAdapter().adapter });
    expect((await readPush(id)).oneCPushStatus).toBe('none');
  });

  it('адаптер бросил — failed, текст, счётчик, push_failed с сообщением', async () => {
    const id = await createDoc();
    const { adapter } = fakeAdapter(async () => {
      throw new Error('1C POST /api/documents failed: 503');
    });
    const res = await pushDocumentToOneC(prisma, id, { adapter, actorUserId: managerId });
    expect(res).toEqual({
      ok: false,
      error: 'push_failed',
      message: '1C POST /api/documents failed: 503',
    });
    expect(await readPush(id)).toMatchObject({
      oneCPushStatus: 'failed',
      oneCPushError: '1C POST /api/documents failed: 503',
      oneCPushAttempts: 1,
      oneCExternalId: null,
      oneCPushedVersion: null,
    });
    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'document', entityId: id, action: 'document_push_to_1c_failed' },
    });
    expect(audit?.userId).toBe(managerId);

    // Повтор после починки 1С: счётчик растёт, статус — pushed, ошибка снята.
    const ok = await pushDocumentToOneC(prisma, id, { adapter: fakeAdapter().adapter });
    expect(ok.ok).toBe(true);
    expect(await readPush(id)).toMatchObject({
      oneCPushStatus: 'pushed',
      oneCPushError: null,
      oneCPushAttempts: 2,
    });
  });

  it('документ без строк и итогов (до этапа 6) уезжает с lines: null и totals: null (спека 3.5)', async () => {
    const id = await createDoc(
      { number: 'С-2026-7', amountNet: null, amountVat: null, amountGross: null, currency: null },
      false
    );
    const { adapter, pushDocument } = fakeAdapter();
    const res = await pushDocumentToOneC(prisma, id, { adapter });
    expect(res.ok).toBe(true);
    const body = pushDocument.mock.calls[0][0] as OneCDocumentPushPayload;
    expect(body.lines).toBeNull();
    expect(body.totals).toBeNull();
  });

  it('организация без ИНН — counterparty_without_inn: failed с русским текстом, адаптер не вызван', async () => {
    const id = await createDoc({ counterpartyId: orgNoInnId });
    const { adapter, pushDocument } = fakeAdapter();
    const res = await pushDocumentToOneC(prisma, id, { adapter });
    expect(res).toEqual({ ok: false, error: 'counterparty_without_inn' });
    expect(pushDocument).not.toHaveBeenCalled();
    expect(await readPush(id)).toMatchObject({
      oneCPushStatus: 'failed',
      oneCPushError: expect.stringMatching(/ИНН/),
      oneCPushAttempts: 1,
    });
  });

  it('документ без номера — no_number: failed с русским текстом', async () => {
    const id = await createDoc({ number: null });
    const res = await pushDocumentToOneC(prisma, id, { adapter: fakeAdapter().adapter });
    expect(res).toEqual({ ok: false, error: 'no_number' });
    expect((await readPush(id)).oneCPushError).toMatch(/номера/);
  });

  it('документ без заказа и без актора: order: null, аудит — от автора документа', async () => {
    const id = await createDoc({ orderId: null });
    const { adapter, pushDocument } = fakeAdapter();
    await pushDocumentToOneC(prisma, id, { adapter });
    expect((pushDocument.mock.calls[0][0] as OneCDocumentPushPayload).order).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'document', entityId: id, action: 'document_pushed_to_1c' },
    });
    expect(audit?.userId).toBe(managerId);
  });

  it('несуществующий документ — not_found', async () => {
    const res = await pushDocumentToOneC(prisma, 'no-such-doc', { adapter: fakeAdapter().adapter });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('pushDocumentProcessor — воркер (страж worker.processor-coverage)', () => {
  it('выгружает через настроенный адаптер и отдаёт outcome: pushed', async () => {
    const id = await createDoc();
    const result = await pushDocumentProcessor(job({ documentId: id, actorUserId: managerId }), prisma);
    expect(result).toEqual({ documentId: id, outcome: 'pushed' });
    expect((await readPush(id)).oneCExternalId).toBe(`1c-doc-${id}`);

    const again = await pushDocumentProcessor(job({ documentId: id }), prisma);
    expect(again).toEqual({ documentId: id, outcome: 'same_version' });
  });

  it('сбой адаптера — исключение наружу, чтобы BullMQ повторил', async () => {
    const id = await createDoc();
    process.env.FAKE_ONEC_FAILURE_RATE = '1';
    resetOneCAdapter();
    await expect(pushDocumentProcessor(job({ documentId: id }), prisma)).rejects.toThrow(
      /simulated failure/
    );
    expect((await readPush(id)).oneCPushStatus).toBe('failed');
  });

  it('окончательный отказ — без исключения: задача завершена, outcome — код отказа', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const id = await createDoc({ type: 'commercial_proposal' });
    const result = await pushDocumentProcessor(job({ documentId: id }), prisma);
    expect(result).toEqual({ documentId: id, outcome: 'not_pushable_type' });
    expect(warn).toHaveBeenCalledWith(
      '[worker] push-document refused',
      expect.objectContaining({ documentId: id, error: 'not_pushable_type' })
    );
    warn.mockRestore();
  });
});

describe('enqueueDocumentPush — продюсер очереди', () => {
  it('ставит pending и кладёт задачу без собственного jobId', async () => {
    const id = await createDoc();
    queueAdd.mockResolvedValueOnce({ id: 'job-1' });
    const res = await enqueueDocumentPush(prisma, id, { actorUserId: managerId });
    expect(res).toEqual({ ok: true });
    expect(getQueue).toHaveBeenCalledWith('oneCSync.pushDocument');
    expect(queueAdd).toHaveBeenCalledWith('push', { documentId: id, actorUserId: managerId });
    expect((await readPush(id)).oneCPushStatus).toBe('pending');

    // Повторная постановка, пока задача не отработала, — already_queued.
    expect(await enqueueDocumentPush(prisma, id)).toEqual({ ok: false, error: 'already_queued' });
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it('Redis недоступен — статус прежний, ошибка в логе, вызов не бросил (спека 3.3)', async () => {
    const error = vi.spyOn(log, 'error').mockImplementation(() => {});
    const id = await createDoc({ oneCPushStatus: 'failed', oneCPushError: 'старая ошибка' });
    getQueue.mockImplementationOnce(() => {
      throw new Error('REDIS_URL is not set');
    });
    const res = await enqueueDocumentPush(prisma, id);
    expect(res).toEqual({ ok: false, error: 'queue_unavailable' });
    expect(error).toHaveBeenCalledWith(
      '[oneCSync] document push enqueue failed',
      expect.objectContaining({ documentId: id, error: 'REDIS_URL is not set' })
    );
    expect((await readPush(id)).oneCPushStatus).toBe('failed');
    error.mockRestore();
  });

  it('КП, заменённая версия и чужой id — отказ до очереди', async () => {
    const kp = await createDoc({ type: 'commercial_proposal' });
    expect(await enqueueDocumentPush(prisma, kp)).toEqual({ ok: false, error: 'not_pushable_type' });
    const old = await createDoc({ supersededAt: new Date() });
    expect(await enqueueDocumentPush(prisma, old)).toEqual({ ok: false, error: 'superseded' });
    expect(await enqueueDocumentPush(prisma, 'no-such-doc')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(queueAdd).not.toHaveBeenCalled();
  });
});
