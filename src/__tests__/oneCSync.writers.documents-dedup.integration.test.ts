import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// S3 и Redis — моки (файл «забрали», задачу «положили»), Postgres — живой:
// три ключа поиска, частичный уникальный индекс номера и дверь статусов
// (с журналом аудита) проверяются на настоящих строках.
const { fetchAndStore1CDocument, queueAdd, getQueue, notifyOrgUsers } = vi.hoisted(() => {
  const queueAdd = vi.fn();
  return {
    fetchAndStore1CDocument: vi.fn(),
    queueAdd,
    getQueue: vi.fn(() => ({ add: queueAdd })),
    notifyOrgUsers: vi.fn(),
  };
});
vi.mock('@/lib/services/oneCSync/document-fetch', () => ({ fetchAndStore1CDocument }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers, notifyManagers: vi.fn() }));

import { upsertDocumentRecord } from '@/lib/services/oneCSync/writers';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';
import { OneCDocumentSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCDocumentDto } from '@/lib/services/oneCSync/dto';

/**
 * Этап 8, PR-6 (`У-170`, `Д-24`, `Д-25`) — обратная связь из 1С.
 *
 * До PR-6 подписанный в 1С договор возвращался в кабинет ВТОРЫМ документом:
 * writer искал только по `externalId`, а у выгруженной нами бумаги он пуст.
 * Здесь проверяется, что документ находится по трём ключам, обновляется на
 * месте, при смене файла уходит на повторный скан и принимается через дверь
 * статусов.
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyId: string;
let orgId: string;
let managerId: string;
let orderId: string;
let orderExternalId: string;
let otherOrderId: string;
let otherOrderExternalId: string;
const createdDocIds: string[] = [];
let fetchCounter = 0;

type DocOverrides = Parameters<PrismaClient['document']['create']>[0]['data'];

/** Документ, выпущенный кабинетом и (по умолчанию) уже выгруженный в 1С. */
async function createOurDoc(overrides: Partial<DocOverrides> = {}): Promise<string> {
  const n = createdDocIds.length + 1;
  const doc = await prisma.document.create({
    data: {
      name: `s8p6-${STAMP}-${n}.pdf`,
      path: `documents/s8p6-${STAMP}-${n}.pdf`,
      mimeType: 'application/pdf',
      size: 1000,
      type: 'contract',
      direction: 'outgoing',
      number: `Д-2026-${STAMP}-${n}`,
      status: 'sent',
      companyId,
      orderId,
      counterpartyType: 'organization',
      counterpartyId: orgId,
      uploadedById: managerId,
      generatedBy: 'system',
      scanStatus: 'clean',
      // страж базы: «выгружен» ⟹ есть дата и версия выгрузки
      oneCPushStatus: 'pushed',
      oneCPushedAt: new Date('2026-08-20T00:00:00Z'),
      oneCPushedVersion: 1,
      oneCExternalId: `1c-ret-${STAMP}-${n}`,
      ...overrides,
    } as DocOverrides,
    select: { id: true },
  });
  createdDocIds.push(doc.id);
  return doc.id;
}

function dto(over: Partial<OneCDocumentDto> & { externalId: string }): OneCDocumentDto {
  return {
    orderExternalId,
    direction: 'incoming',
    type: 'contract',
    name: `Из 1С ${over.externalId}.pdf`,
    mimeType: 'application/pdf',
    size: 1000,
    downloadUrl: `https://1c.test/files/${over.externalId}`,
    updatedAt: '2026-09-01T10:00:00Z',
    ...over,
  };
}

const live = { mode: 'live' as const, notify: true };

/** Всё, что этот тест создал сам, — по «нашему» id 1С или по id, которые выдала 1С. */
async function rememberCreated(externalId: string) {
  const rows = await prisma.document.findMany({ where: { externalId }, select: { id: true } });
  for (const r of rows) if (!createdDocIds.includes(r.id)) createdDocIds.push(r.id);
  return rows;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  companyId = (await prisma.company.create({ data: { name: `s8p6-${STAMP}` } })).id;
  orgId = (
    await prisma.organization.create({
      data: {
        name: `s8p6-org-${STAMP}`,
        inn: `77${String(STAMP).slice(-8)}`,
        companyId,
      },
    })
  ).id;
  managerId = (
    await prisma.user.create({
      data: { email: `s8p6-m-${STAMP}@t.local`, name: 'М', role: 'manager', companyId },
    })
  ).id;
  orderExternalId = `1c-order-s8p6-${STAMP}`;
  orderId = (
    await prisma.order.create({
      data: {
        title: `s8p6-o-${STAMP}`,
        orderNumber: `З-${STAMP}`,
        externalId: orderExternalId,
        companyId,
        organizationId: orgId,
        managerId,
      },
    })
  ).id;
  otherOrderExternalId = `1c-order-s8p6-b-${STAMP}`;
  otherOrderId = (
    await prisma.order.create({
      data: {
        title: `s8p6-o2-${STAMP}`,
        orderNumber: `З-${STAMP}-2`,
        externalId: otherOrderExternalId,
        companyId,
        organizationId: orgId,
        managerId,
      },
    })
  ).id;
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchAndStore1CDocument.mockImplementation(
    async () => `orders/${orderId}/1c/fetched-${STAMP}-${++fetchCounter}.pdf`
  );
  delete process.env.REDIS_URL;
});

afterAll(async () => {
  await prisma.document.deleteMany({ where: { id: { in: createdDocIds } } });
  await prisma.document.deleteMany({ where: { orderId: { in: [orderId, otherOrderId] } } });
  await prisma.auditLog.deleteMany({ where: { userId: managerId } });
  await prisma.order.deleteMany({ where: { id: { in: [orderId, otherOrderId] } } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: managerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('upsertDocumentRecord — три ключа поиска (`У-170`, `Д-24`)', () => {
  it('ключ 1: тот же externalId дважды — одна строка, второй раз «обновлён»', async () => {
    const externalId = `1c-k1-${STAMP}`;
    const first = emptySummary();
    await upsertDocumentRecord(prisma, dto({ externalId }), first, live);
    const second = emptySummary();
    await upsertDocumentRecord(prisma, dto({ externalId, size: 1000 }), second, live);

    const rows = await rememberCreated(externalId);
    expect(rows).toHaveLength(1);
    expect(first).toMatchObject({ created: 1, updated: 0 });
    expect(second).toMatchObject({ created: 0, updated: 1 });
    // файл не менялся — второй раз не забирался, уведомление одно
    expect(fetchAndStore1CDocument).toHaveBeenCalledTimes(1);
    expect(notifyOrgUsers).toHaveBeenCalledTimes(1);
  });

  it('ключ 2: выгруженный нами документ вернулся из 1С под её id — обновлён, дубля нет', async () => {
    const id = await createOurDoc();
    const before = await prisma.document.findUniqueOrThrow({ where: { id } });
    const oneCId = before.oneCExternalId!;

    const sum = emptySummary();
    await upsertDocumentRecord(
      prisma,
      dto({ externalId: oneCId, name: 'Чужое имя.pdf' }),
      sum,
      live
    );

    expect(sum).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    expect(await prisma.document.count({ where: { oneCExternalId: oneCId } })).toBe(1);
    expect(await prisma.document.count({ where: { externalId: oneCId } })).toBe(0);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
    // наш документ: имя, направление и номер остались нашими
    expect(doc.name).toBe(before.name);
    expect(doc.number).toBe(before.number);
    expect(doc.direction).toBe('outgoing');
    expect(doc.status).toBe('sent');
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('ключ 2 берёт действующую версию цепочки перевыпусков, а не заменённую', async () => {
    const oneCId = `1c-chain-${STAMP}`;
    const v1 = await createOurDoc({
      oneCExternalId: oneCId,
      supersededAt: new Date('2026-08-01T00:00:00Z'),
    });
    const v2 = await createOurDoc({ oneCExternalId: oneCId, version: 2, number: null });
    await prisma.document.update({
      where: { id: v2 },
      data: { number: (await prisma.document.findUniqueOrThrow({ where: { id: v1 } })).number },
    });

    await upsertDocumentRecord(
      prisma,
      dto({ externalId: oneCId, signedAt: '2026-09-02T00:00:00Z' }),
      emptySummary(),
      live
    );

    expect((await prisma.document.findUniqueOrThrow({ where: { id: v2 } })).signedAt).toEqual(
      new Date('2026-09-02T00:00:00Z')
    );
    expect((await prisma.document.findUniqueOrThrow({ where: { id: v1 } })).signedAt).toBeNull();
  });

  it('ключ 3: тот же тип и номер в заказе (id 1С ещё не знаем) — обновлён, oneCExternalId записан', async () => {
    const id = await createOurDoc({
      oneCExternalId: null,
      oneCPushStatus: 'none',
      oneCPushedAt: null,
      oneCPushedVersion: null,
    });
    const number = (await prisma.document.findUniqueOrThrow({ where: { id } })).number!;
    const externalId = `1c-k3-${STAMP}`;

    const sum = emptySummary();
    await upsertDocumentRecord(prisma, dto({ externalId, number }), sum, live);

    expect(sum).toMatchObject({ created: 0, updated: 1 });
    expect(await prisma.document.count({ where: { externalId } })).toBe(0);
    expect((await prisma.document.findUniqueOrThrow({ where: { id } })).oneCExternalId).toBe(
      externalId
    );
  });

  it('ключ 3 не выходит за пределы заказа: тот же номер в другом заказе — новый документ без номера', async () => {
    const id = await createOurDoc({
      oneCExternalId: null,
      oneCPushStatus: 'none',
      oneCPushedAt: null,
      oneCPushedVersion: null,
    });
    const number = (await prisma.document.findUniqueOrThrow({ where: { id } })).number!;
    const externalId = `1c-k3b-${STAMP}`;

    const sum = emptySummary();
    await upsertDocumentRecord(
      prisma,
      dto({ externalId, number, orderExternalId: otherOrderExternalId }),
      sum,
      live
    );

    expect(sum).toMatchObject({ created: 1, failed: 0 });
    const rows = await rememberCreated(externalId);
    expect(rows).toHaveLength(1);
    const created = await prisma.document.findUniqueOrThrow({ where: { id: rows[0].id } });
    // частичный уникальный индекс (companyId, type, number, version) не нарушен
    expect(created.number).toBeNull();
    expect(created.orderId).toBe(otherOrderId);
  });
});

describe('upsertDocumentRecord — файл и подпись (`У-170`, `Д-24`)', () => {
  it('файл в 1С изменился — новый path, скан заново (pending), задача в docs.scanDocument', async () => {
    process.env.REDIS_URL = 'redis://test';
    const id = await createOurDoc();
    const before = await prisma.document.findUniqueOrThrow({ where: { id } });

    await upsertDocumentRecord(
      prisma,
      dto({ externalId: before.oneCExternalId!, size: 2048 }),
      emptySummary(),
      live
    );

    const after = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(after.path).not.toBe(before.path);
    expect(after.path).toMatch(/^orders\/.+\/1c\/fetched-/);
    expect(after.size).toBe(2048);
    expect(after.scanStatus).toBe('pending');
    expect(after.scannedAt).toBeNull();
    expect(getQueue).toHaveBeenCalledWith('docs.scanDocument');
    expect(queueAdd).toHaveBeenCalledWith('scan', { kind: 'document', id });
  });

  it('файл изменился, но забрать не удалось — пропуск document_fetch_failed, строка не тронута', async () => {
    fetchAndStore1CDocument.mockResolvedValue(null);
    const id = await createOurDoc();
    const before = await prisma.document.findUniqueOrThrow({ where: { id } });

    const sum = emptySummary();
    await upsertDocumentRecord(
      prisma,
      dto({ externalId: before.oneCExternalId!, size: 2048 }),
      sum,
      live
    );

    expect(sum.skips[0]).toEqual({
      externalId: before.oneCExternalId,
      reason: 'document_fetch_failed',
    });
    const after = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(after.path).toBe(before.path);
    expect(after.size).toBe(1000);
  });

  it('1С сообщила о подписи — документ «принят» через дверь статусов, автор — выпустивший, аудит записан', async () => {
    const id = await createOurDoc({ status: 'sent' });
    const oneCId = (await prisma.document.findUniqueOrThrow({ where: { id } })).oneCExternalId!;

    await upsertDocumentRecord(
      prisma,
      dto({ externalId: oneCId, signedAt: '2026-09-02T12:00:00Z' }),
      emptySummary(),
      live
    );

    const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe('accepted');
    expect(doc.signedAt).toEqual(new Date('2026-09-02T12:00:00Z'));
    expect(doc.acceptedByUserId).toBe(managerId);
    expect(doc.acceptedAt).not.toBeNull();
    // подписанный скан — другой файл: забран заново
    expect(fetchAndStore1CDocument).toHaveBeenCalledTimes(1);
    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'document', entityId: id, action: 'document_status_changed' },
    });
    expect(audit?.userId).toBe(managerId);
  });

  it('подпись у аннулированного документа статус не меняет (дверь отказала, пакет не упал)', async () => {
    const id = await createOurDoc({ status: 'cancelled' });
    const oneCId = (await prisma.document.findUniqueOrThrow({ where: { id } })).oneCExternalId!;

    const sum = emptySummary();
    await upsertDocumentRecord(
      prisma,
      dto({ externalId: oneCId, signedAt: '2026-09-02T12:00:00Z' }),
      sum,
      live
    );

    expect(sum).toMatchObject({ updated: 1, failed: 0 });
    const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe('cancelled');
    expect(doc.signedAt).toEqual(new Date('2026-09-02T12:00:00Z'));
  });
});

describe('upsertDocumentRecord — направление из DTO (`У-170`, `Д-25`)', () => {
  it('direction: outgoing из 1С сохраняется как есть', async () => {
    const externalId = `1c-dir-out-${STAMP}`;
    await upsertDocumentRecord(
      prisma,
      dto({ externalId, direction: 'outgoing' }),
      emptySummary(),
      live
    );
    const rows = await rememberCreated(externalId);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(doc.direction).toBe('outgoing');
    expect(doc.oneCExternalId).toBe(externalId);
  });

  it('1С без поля direction — документ входящий (умолчание схемы), number записан', async () => {
    const externalId = `1c-dir-none-${STAMP}`;
    const raw = {
      externalId,
      orderExternalId,
      type: 'act',
      number: `А-${STAMP}`,
      name: 'Акт.pdf',
      mimeType: 'application/pdf',
      size: 10,
      downloadUrl: 'https://1c.test/files/x',
      updatedAt: '2026-09-01T10:00:00Z',
    };
    await upsertDocumentRecord(prisma, OneCDocumentSchema.parse(raw), emptySummary(), live);
    const rows = await rememberCreated(externalId);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(doc.direction).toBe('incoming');
    expect(doc.number).toBe(`А-${STAMP}`);
  });
});
