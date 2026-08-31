import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  findNumberingIssues,
  fixNumberingIssues,
  isClean,
} from '@/lib/services/documents/numberingMaintenance';

/**
 * Этап 6, PR-8b (`У-151`) — разбор исторических номеров на ЖИВОМ Postgres.
 *
 * Фейковая prisma здесь бесполезна дважды: запросы отчёта написаны сырым SQL
 * (компания у документа лежит в двух разных таблицах), а «до/после» имеет
 * смысл только на настоящих строках. Обе ветки требования проверяются здесь:
 * «есть расхождения» и «пусто».
 *
 * Тест сам создаёт грязь и сам её убирает: боевых данных в базе нет, а
 * оставленный мусор уронил бы следующий прогон.
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string, orgA: string, manager: string, order1: string;
const created: string[] = [];

const DOC = (over: Record<string, unknown>) => ({
  name: `s6p8b-${STAMP}.pdf`,
  path: `test/${STAMP}/${Math.random()}`,
  mimeType: 'application/pdf',
  counterpartyType: 'organization' as const,
  counterpartyId: orgA,
  generatedBy: 'system' as const,
  direction: 'outgoing' as const,
  ...over,
});

async function makeDoc(over: Record<string, unknown>): Promise<string> {
  const doc = await prisma.document.create({ data: DOC(over) as never, select: { id: true } });
  created.push(doc.id);
  return doc.id;
}

const UNIQUE_INDEX = 'Document_companyId_type_number_version_key';

/**
 * Ограничения, которые вешает миграция. Пока они стоят, грязь, ради которой
 * написана чинилка, физически не создать — база не даст. Поэтому файл снимает
 * их на время и возвращает в конце, а последний тест доказывает, что после
 * чистки они встают обратно.
 */
const ADD_CONSTRAINTS = [
  `CREATE UNIQUE INDEX "${UNIQUE_INDEX}" ON "Document"("companyId", "type", "number", "version") WHERE "number" IS NOT NULL`,
  `ALTER TABLE "Document" ADD CONSTRAINT "Document_replacesDocumentId_fkey" FOREIGN KEY ("replacesDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "DocumentCounter" ADD CONSTRAINT "DocumentCounter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
];
const DROP_CONSTRAINTS = [
  `DROP INDEX IF EXISTS "${UNIQUE_INDEX}"`,
  `ALTER TABLE "Document" DROP CONSTRAINT IF EXISTS "Document_replacesDocumentId_fkey"`,
  `ALTER TABLE "DocumentCounter" DROP CONSTRAINT IF EXISTS "DocumentCounter_companyId_fkey"`,
];

/**
 * Чинилка по замыслу работает ДО того, как встал уникальный индекс: сначала
 * отчёт, потом чистка, и только потом ограничения. Значит и проверять её надо
 * в том же порядке — иначе грязь, ради которой она написана, просто не
 * создать. Индекс снимается на время файла и возвращается в конце; последний
 * тест доказывает, что после чистки он встаёт.
 */
beforeAll(async () => {
  prisma = new PrismaClient();
  for (const sql of DROP_CONSTRAINTS) await prisma.$executeRawUnsafe(sql);
  companyA = (
    await prisma.company.create({
      data: { name: `s6p8b-co-${STAMP}`, inn: `77${STAMP % 100000000}` },
    })
  ).id;
  orgA = (
    await prisma.organization.create({ data: { name: `s6p8b-org-${STAMP}`, companyId: companyA } })
  ).id;
  manager = (
    await prisma.user.create({
      data: { email: `s6p8b-${STAMP}@t.local`, name: 'М', role: 'manager', companyId: companyA },
    })
  ).id;
  order1 = (
    await prisma.order.create({
      data: {
        title: `s6p8b-o-${STAMP}`,
        companyId: companyA,
        organizationId: orgA,
        managerId: manager,
        totalAmount: 1000,
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.documentNumberingBackup.deleteMany({ where: { documentId: { in: created } } });
  await prisma.document.updateMany({
    where: { id: { in: created } },
    data: { parentDocumentId: null, replacesDocumentId: null },
  });
  await prisma.document.deleteMany({ where: { id: { in: created } } });
  await prisma.documentCounter.deleteMany({ where: { companyId: companyA } });
  await prisma.order.deleteMany({ where: { id: order1 } });
  await prisma.organization.deleteMany({ where: { id: orgA } });
  await prisma.user.deleteMany({ where: { id: manager } });
  await prisma.company.deleteMany({ where: { id: companyA } });
  for (const sql of ADD_CONSTRAINTS) await prisma.$executeRawUnsafe(sql);
  await prisma.$disconnect();
});

describe('разбор исторических номеров (`У-151`)', () => {
  it('на чистых данных отчёт пуст, а чинить нечего', async () => {
    const issues = await findNumberingIssues(prisma);
    // База тестовая: посторонней грязи в ней быть не должно. Если этот тест
    // покраснел — сначала посмотрите отчёт, а не правьте ожидание.
    expect(isClean(issues)).toBe(true);
  });

  it('дубли номеров разводятся версиями, номер не меняется, «до» сохраняется', async () => {
    const first = await makeDoc({
      orderId: order1,
      companyId: companyA,
      type: 'invoice',
      number: `С-${STAMP}-1`,
      version: 1,
      createdAt: new Date('2026-01-01'),
    });
    const second = await makeDoc({
      orderId: order1,
      companyId: companyA,
      type: 'invoice',
      number: `С-${STAMP}-1`,
      version: 1,
      createdAt: new Date('2026-02-01'),
    });

    const before = await findNumberingIssues(prisma);
    const group = before.duplicates.find((g) => g.number === `С-${STAMP}-1`);
    expect(group).toBeDefined();
    expect(group!.documentIds).toEqual([first, second]);

    const report = await fixNumberingIssues(prisma);
    expect(report.versionsBumped).toContainEqual({ documentId: second, from: 1, to: 2 });

    const rows = await prisma.document.findMany({
      where: { id: { in: [first, second] } },
      select: { id: true, number: true, version: true },
      orderBy: { version: 'asc' },
    });
    // Номер не тронут: он напечатан в PDF и назван в имени файла.
    expect(rows.map((r) => r.number)).toEqual([`С-${STAMP}-1`, `С-${STAMP}-1`]);
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    // Самый ранний документ остаётся при своей версии — бумага уже у клиента.
    expect(rows[0]!.id).toBe(first);

    const backup = await prisma.documentNumberingBackup.findMany({
      where: { documentId: second, field: 'version' },
    });
    expect(backup).toHaveLength(1);
    expect(backup[0]!.oldValue).toBe('1');

    const after = await findNumberingIssues(prisma);
    expect(after.duplicates.find((g) => g.number === `С-${STAMP}-1`)).toBeUndefined();
  });

  it('акту проставляется связь со счётом того же заказа по совпадению номера', async () => {
    const invoice = await makeDoc({
      orderId: order1,
      companyId: companyA,
      type: 'invoice',
      number: `С-${STAMP}-9`,
      version: 1,
    });
    const act = await makeDoc({
      orderId: order1,
      companyId: companyA,
      type: 'act',
      number: `С-${STAMP}-9`,
      version: 1,
    });

    const before = await findNumberingIssues(prisma);
    expect(
      before.missingParents.some((r) => r.documentId === act && r.candidateId === invoice)
    ).toBe(true);

    await fixNumberingIssues(prisma);

    const saved = await prisma.document.findUniqueOrThrow({
      where: { id: act },
      select: { parentDocumentId: true },
    });
    expect(saved.parentDocumentId).toBe(invoice);
    const backup = await prisma.documentNumberingBackup.findMany({
      where: { documentId: act, field: 'parentDocumentId' },
    });
    // «До» — пусто, и это записано явно: иначе откат не отличил бы
    // «связи не было» от «строки нет».
    expect(backup).toHaveLength(1);
    expect(backup[0]!.oldValue).toBeNull();
  });

  it('ссылка на несуществующий документ обнуляется, прежнее значение сохраняется', async () => {
    const ghost = 'нет-такого-документа';
    const doc = await makeDoc({
      orderId: order1,
      companyId: companyA,
      type: 'contract',
      number: `Д-${STAMP}-1`,
      version: 1,
      replacesDocumentId: ghost,
    });

    const before = await findNumberingIssues(prisma);
    expect(before.orphanReplaces).toContainEqual({ documentId: doc, replacesDocumentId: ghost });

    const report = await fixNumberingIssues(prisma);
    expect(report.orphanReplacesCleared).toBeGreaterThanOrEqual(1);

    const saved = await prisma.document.findUniqueOrThrow({
      where: { id: doc },
      select: { replacesDocumentId: true },
    });
    expect(saved.replacesDocumentId).toBeNull();
    const backup = await prisma.documentNumberingBackup.findMany({
      where: { documentId: doc, field: 'replacesDocumentId' },
    });
    expect(backup[0]!.oldValue).toBe(ghost);
  });

  it('счётчик без компании находится и удаляется', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DocumentCounter" ("companyId","year","kind","lastNumber")
       VALUES ($1, 2026, 'invoice', 5)`,
      `нет-такой-компании-${STAMP}`
    );

    const before = await findNumberingIssues(prisma);
    expect(before.orphanCounters.some((c) => c.companyId === `нет-такой-компании-${STAMP}`)).toBe(
      true
    );

    const report = await fixNumberingIssues(prisma);
    expect(report.orphanCountersDeleted).toBeGreaterThanOrEqual(1);

    const after = await findNumberingIssues(prisma);
    expect(after.orphanCounters.some((c) => c.companyId === `нет-такой-компании-${STAMP}`)).toBe(
      false
    );
  });

  /**
   * Составной ключ «документ → заказ» задаёт не только совпадение компаний, но
   * и что происходит при удалении заказа. Без явного `ON DELETE SET NULL
   * ("orderId")` он перебивал одиночный ключ и запрещал удалять заказ, у
   * которого есть документы, — бумага пропадала бы вместе со сценарием
   * удаления, а не переставала быть привязанной к заказу.
   */
  it('удаление заказа не запрещено документами: документ теряет заказ, но не компанию', async () => {
    const tmpOrder = await prisma.order.create({
      data: {
        title: `s6p8b-del-${STAMP}`,
        companyId: companyA,
        organizationId: orgA,
        managerId: manager,
        totalAmount: 100,
      },
      select: { id: true },
    });
    const doc = await makeDoc({
      orderId: tmpOrder.id,
      companyId: companyA,
      type: 'other',
      number: null,
      version: 1,
    });

    await prisma.order.delete({ where: { id: tmpOrder.id } });

    const saved = await prisma.document.findUniqueOrThrow({
      where: { id: doc },
      select: { orderId: true, companyId: true },
    });
    expect(saved.orderId).toBeNull();
    // Компания уцелела: иначе документ нарушил бы NOT NULL и удаление заказа
    // упало бы вовсе.
    expect(saved.companyId).toBe(companyA);
  });

  it('компания документа не может разойтись с компанией его заказа', async () => {
    // Это и есть смысл составного ключа: инвариант держит база, а не
    // аккуратность вызывающего кода.
    const other = await prisma.company.create({
      data: { name: `s6p8b-other-${STAMP}`, inn: `78${STAMP % 100000000}` },
      select: { id: true },
    });
    await expect(
      prisma.document.create({
        data: DOC({ orderId: order1, companyId: other.id, type: 'other', version: 1 }) as never,
      })
    ).rejects.toThrow();
    await prisma.company.delete({ where: { id: other.id } });
  });

  it('после чистки отчёт пуст И уникальный индекс встаёт — это и есть условие миграции', async () => {
    const after = await findNumberingIssues(prisma);
    expect(isClean(after)).toBe(true);

    // Главная проверка файла: пустой отчёт обязан означать, что ограничение
    // реально встанет. Разъедься эти две вещи — миграция падала бы на
    // выкладке при зелёном отчёте, то есть ровно там, где дороже всего.
    for (const sql of ADD_CONSTRAINTS) await prisma.$executeRawUnsafe(sql);
    for (const sql of DROP_CONSTRAINTS) await prisma.$executeRawUnsafe(sql);
  });
});
