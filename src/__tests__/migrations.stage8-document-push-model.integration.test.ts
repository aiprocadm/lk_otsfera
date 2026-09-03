import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Этап 8, PR-1 (`У-168`, `У-169`) — модель выгрузки документов в 1С на ЖИВОМ
 * Postgres.
 *
 * Почему не unit-тест с поддельной prisma: здесь проверяются умолчания и
 * ограничения САМОЙ БАЗЫ. Поддельная prisma согласится записать КП в набор
 * типов и «выгружен, но неизвестно какая версия», потому что запреты живут в
 * SQL, а не в коде. Единственный способ доказать, что база их держит, —
 * попробовать записать и получить отказ.
 *
 * Две проверки миграции `20260903100000_stage8_document_push_model`:
 *  1. `Company_oneCDocumentPushTypes_pushable` — в наборе только четыре типа,
 *     которые вообще уезжают в 1С (счёт, акт, договор, ДС); КП — никогда
 *     (`Р-14`), даже мимо интерфейса;
 *  2. `Document_oneC_pushed_has_version` — `pushed` только вместе с временем и
 *     версией: без версии идемпотентность (`У-167`) сравнивать не с чем.
 *
 * Тест убирает за собой: боевых данных в базе нет, а оставленный мусор
 * помешал бы следующему прогону.
 */

let prisma: PrismaClient;
const T = `s8p1-${Date.now()}`;
let companyId = '';
let organizationId = '';
const docs: string[] = [];
const companies: string[] = [];

/** Обязательный минимум полей документа; всё остальное задаёт конкретный тест. */
function docData(over: Record<string, unknown>): Record<string, unknown> {
  return {
    name: `${T}.pdf`,
    path: `${T}/${Math.random()}`,
    mimeType: 'application/pdf',
    type: 'invoice',
    direction: 'outgoing',
    generatedBy: 'system',
    companyId,
    counterpartyType: 'organization',
    counterpartyId: organizationId,
    ...over,
  };
}

async function makeDoc(over: Record<string, unknown>): Promise<string> {
  const doc = await prisma.document.create({
    data: docData(over) as never,
    select: { id: true },
  });
  docs.push(doc.id);
  return doc.id;
}

async function makeCompany(over: Record<string, unknown>): Promise<string> {
  const company = await prisma.company.create({
    data: { name: `${T}-co-${companies.length}`, ...over } as never,
    select: { id: true },
  });
  companies.push(company.id);
  return company.id;
}

/**
 * Текст ошибки базы. Проверять локализованное сообщение нельзя — оно зависит
 * от сервера; имя нарушенного ограничения стабильно и в нём есть всегда.
 */
async function failure(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return String((e as Error).message);
  }
  throw new Error('ожидался отказ базы, но запись прошла');
}

beforeAll(async () => {
  prisma = new PrismaClient();
  companyId = await makeCompany({ inn: `77${Date.now() % 100000000}` });
  organizationId = (await prisma.organization.create({ data: { name: `${T}-org`, companyId } })).id;
});

afterAll(async () => {
  await prisma.document.deleteMany({ where: { id: { in: docs } } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.company.deleteMany({ where: { id: { in: companies } } });
  await prisma.$disconnect();
});

describe('этап 8 PR-1: правило выгрузки у компании', () => {
  it('новая компания ничего не шлёт сама: «только по кнопке» и все четыре типа', async () => {
    const saved = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { oneCDocumentPushMode: true, oneCDocumentPushTypes: true },
    });
    // Умолчание `manual`, а не `auto`: выгрузка — необратимое действие в
    // чужой системе, и компания, которая обновилась и ничего не настроила,
    // не должна начать слать бумаги молча (спека §2).
    expect(saved.oneCDocumentPushMode).toBe('manual');
    expect(saved.oneCDocumentPushTypes).toEqual(['invoice', 'act', 'contract', 'extra_agreement']);
  });

  it('набор можно сузить и включить автовыгрузку — это и есть настройка `У-169`', async () => {
    const id = await makeCompany({
      oneCDocumentPushMode: 'auto',
      oneCDocumentPushTypes: ['invoice'],
    });
    const saved = await prisma.company.findUniqueOrThrow({
      where: { id },
      select: { oneCDocumentPushMode: true, oneCDocumentPushTypes: true },
    });
    expect(saved).toEqual({ oneCDocumentPushMode: 'auto', oneCDocumentPushTypes: ['invoice'] });
  });

  it('пустой набор допустим: «автоматически, но ничего» — это просто выключенная автовыгрузка', async () => {
    const id = await makeCompany({ oneCDocumentPushTypes: [] });
    const saved = await prisma.company.findUniqueOrThrow({
      where: { id },
      select: { oneCDocumentPushTypes: true },
    });
    expect(saved.oneCDocumentPushTypes).toEqual([]);
  });

  it('КП в наборе — отказ базы: в 1С оно не выгружается никогда (`Р-14`)', async () => {
    // Мутация 1 плана. Сними `Company_oneCDocumentPushTypes_pushable` — и КП
    // окажется в наборе мимо интерфейса, а автовыгрузка при выпуске уведёт
    // предпродажный документ в бухгалтерию.
    const msg = await failure(() =>
      makeCompany({ oneCDocumentPushTypes: ['invoice', 'commercial_proposal'] })
    );
    expect(msg).toContain('Company_oneCDocumentPushTypes_pushable');
  });

  it('тип вне контракта (накладная) в наборе — тоже отказ: контракт описывает четыре типа', async () => {
    const msg = await failure(() => makeCompany({ oneCDocumentPushTypes: ['waybill'] }));
    expect(msg).toContain('Company_oneCDocumentPushTypes_pushable');
  });
});

describe('этап 8 PR-1: состояние выгрузки на документе', () => {
  it('новый документ ещё не выгружался: `none`, ноль попыток, всё остальное пусто', async () => {
    const id = await makeDoc({});
    const saved = await prisma.document.findUniqueOrThrow({
      where: { id },
      select: {
        oneCExternalId: true,
        oneCPushStatus: true,
        oneCPushedAt: true,
        oneCPushAttempts: true,
        oneCPushError: true,
        oneCPushedVersion: true,
      },
    });
    expect(saved).toEqual({
      oneCExternalId: null,
      oneCPushStatus: 'none',
      oneCPushedAt: null,
      oneCPushAttempts: 0,
      oneCPushError: null,
      oneCPushedVersion: null,
    });
  });

  it('«выгружен» вместе с временем и версией — записывается', async () => {
    const id = await makeDoc({
      oneCPushStatus: 'pushed',
      oneCPushedAt: new Date(),
      oneCPushedVersion: 1,
      oneCExternalId: `${T}-1c`,
      oneCPushAttempts: 1,
    });
    const saved = await prisma.document.findUniqueOrThrow({
      where: { id },
      select: { oneCPushStatus: true, oneCPushedVersion: true, oneCExternalId: true },
    });
    expect(saved).toEqual({
      oneCPushStatus: 'pushed',
      oneCPushedVersion: 1,
      oneCExternalId: `${T}-1c`,
    });
  });

  it('«выгружен» без версии — отказ базы: сравнивать при повторе было бы не с чем', async () => {
    // Мутация 2 плана. Сними `Document_oneC_pushed_has_version` — и документ в
    // состоянии `pushed` без версии либо уедет в 1С второй раз, либо навсегда
    // пропустит обновление: идемпотентность `У-167` держится на версии.
    const msg = await failure(() =>
      makeDoc({ oneCPushStatus: 'pushed', oneCPushedAt: new Date() })
    );
    expect(msg).toContain('Document_oneC_pushed_has_version');
  });

  it('«выгружен» без времени — тоже отказ: карточке нечего показать в «когда доехало»', async () => {
    const msg = await failure(() => makeDoc({ oneCPushStatus: 'pushed', oneCPushedVersion: 1 }));
    expect(msg).toContain('Document_oneC_pushed_has_version');
  });

  it('«ошибка» и «в очереди» версии не требуют — её ещё нет', async () => {
    const failed = await makeDoc({
      oneCPushStatus: 'failed',
      oneCPushAttempts: 3,
      oneCPushError: '1С ответила 500',
    });
    const pending = await makeDoc({ oneCPushStatus: 'pending' });
    // Перечисление в Postgres сортируется порядком объявления, а не по
    // алфавиту — поэтому порядок задаётся здесь, а не в запросе.
    const rows = (
      await prisma.document.findMany({
        where: { id: { in: [failed, pending] } },
        select: { oneCPushStatus: true, oneCPushError: true },
      })
    ).sort((a, b) => a.oneCPushStatus.localeCompare(b.oneCPushStatus));
    expect(rows).toEqual([
      { oneCPushStatus: 'failed', oneCPushError: '1С ответила 500' },
      { oneCPushStatus: 'pending', oneCPushError: null },
    ]);
  });

  it('две версии одной цепочки делят один идентификатор в 1С — уникальности нет намеренно', async () => {
    // В 1С уезжает id ПЕРВОЙ версии цепочки перевыпусков, и перевыпуск
    // приезжает туда обновлением. Поставь `@unique` на `oneCExternalId` — и
    // вторая версия не запишется вовсе.
    const first = await makeDoc({
      number: `${T}-N`,
      version: 1,
      oneCPushStatus: 'pushed',
      oneCPushedAt: new Date(),
      oneCPushedVersion: 1,
      oneCExternalId: `${T}-chain`,
      supersededAt: new Date(),
    });
    const second = await makeDoc({
      number: `${T}-N`,
      version: 2,
      replacesDocumentId: first,
      oneCPushStatus: 'pushed',
      oneCPushedAt: new Date(),
      oneCPushedVersion: 2,
      oneCExternalId: `${T}-chain`,
    });
    const chain = await prisma.document.findMany({
      where: { oneCExternalId: `${T}-chain` },
      select: { id: true, version: true },
      orderBy: { version: 'asc' },
    });
    expect(chain).toEqual([
      { id: first, version: 1 },
      { id: second, version: 2 },
    ]);
  });
});
