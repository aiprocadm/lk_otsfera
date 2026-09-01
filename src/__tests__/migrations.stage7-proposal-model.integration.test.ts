import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Этап 7, PR-1 (`У-161`, `У-162`, `У-164`) — модель коммерческого предложения
 * на ЖИВОМ Postgres.
 *
 * Почему не unit-тест с поддельной prisma: всё, что здесь проверяется, —
 * это ограничения САМОЙ БАЗЫ. Поддельная prisma согласится записать любую
 * чушь, потому что проверки живут в SQL, а не в коде. Единственный способ
 * доказать, что «счёт без контрагента не создать», — попробовать его создать
 * по-настоящему и получить отказ.
 *
 * Три проверки из миграции читаются так:
 *  1. `both_or_none` — контрагент заполнен целиком либо не заполнен вовсе;
 *  2. `required_unless_proposal` — пустой контрагент разрешён только у КП;
 *  3. `proposal_needs_lead` — КП без контрагента обязано висеть на лиде.
 *
 * Тест убирает за собой: боевых данных в базе нет, а оставленный мусор
 * помешал бы следующему прогону (документы удаляются ДО лида — на нём стоит
 * `RESTRICT`, и это тоже проверяется).
 */

let prisma: PrismaClient;
const T = `s7p1-${Date.now()}`;
let companyId = '';
let organizationId = '';
let leadId = '';
let dealId = '';
let userId = '';
const docs: string[] = [];

/** Обязательный минимум полей документа; всё остальное задаёт конкретный тест. */
function docData(over: Record<string, unknown>): Record<string, unknown> {
  return {
    name: `${T}.pdf`,
    path: `${T}/${Math.random()}`,
    mimeType: 'application/pdf',
    direction: 'outgoing',
    generatedBy: 'system',
    companyId,
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

/**
 * Код ошибки PostgreSQL и имя нарушенного ограничения. Проверять текст
 * сообщения нельзя — он зависит от локали сервера; код и имя стабильны.
 * `23514` — нарушена проверка (CHECK), `23503` — нарушена внешняя связь.
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
  companyId = (
    await prisma.company.create({ data: { name: `${T}-co`, inn: `77${Date.now() % 100000000}` } })
  ).id;
  organizationId = (await prisma.organization.create({ data: { name: `${T}-org`, companyId } })).id;
  userId = (
    await prisma.user.create({
      data: { email: `${T}@t.test`, name: `${T}-user`, role: 'manager', companyId } as never,
    })
  ).id;
  leadId = (
    await prisma.lead.create({
      data: {
        createdByUserId: userId,
        clientCompanyName: `${T}-клиент`,
        clientContactName: 'Иван Петров',
        subject: 'Обучение по охране труда',
        productType: [],
      } as never,
    })
  ).id;
  dealId = (await prisma.deal.create({ data: { companyId, title: `${T}-сделка` } })).id;
});

afterAll(async () => {
  // Порядок важен: на лиде стоит `RESTRICT`, поэтому документы уходят первыми.
  await prisma.document.deleteMany({ where: { id: { in: docs } } });
  await prisma.deal.deleteMany({ where: { id: dealId } });
  await prisma.lead.deleteMany({ where: { id: leadId } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('этап 7 PR-1: контрагент документа стал необязательным, но не бесконтрольным', () => {
  it('КП без контрагента, но с лидом — разрешено: адресата ещё нет в системе', async () => {
    const id = await makeDoc({ type: 'commercial_proposal', leadId, dealId });
    const saved = await prisma.document.findUniqueOrThrow({
      where: { id },
      select: { counterpartyType: true, counterpartyId: true, leadId: true, dealId: true },
    });
    expect(saved).toEqual({
      counterpartyType: null,
      counterpartyId: null,
      leadId,
      dealId,
    });
  });

  it('КП с контрагентом и без лида — тоже разрешено: предложение действующему заказчику', async () => {
    const id = await makeDoc({
      type: 'commercial_proposal',
      counterpartyType: 'organization',
      counterpartyId: organizationId,
    });
    const saved = await prisma.document.findUniqueOrThrow({
      where: { id },
      select: { counterpartyId: true, leadId: true },
    });
    expect(saved).toEqual({ counterpartyId: organizationId, leadId: null });
  });

  it('счёт без контрагента — отказ: послабление касается ТОЛЬКО коммерческого предложения', async () => {
    // Мутация 1 плана. Убери проверку `required_unless_proposal` — и счёт без
    // адресата запишется, а канальные выборки просто перестанут его находить:
    // документ станет невидимым везде, кроме поиска по номеру.
    const msg = await failure(() => makeDoc({ type: 'invoice', leadId }));
    expect(msg).toContain('Document_counterparty_required_unless_proposal');
  });

  it('контрагент заполнен наполовину — отказ, в обе стороны', async () => {
    // Мутация 2 плана. Половина контрагента не значит ничего: канальные
    // выборки сравнивают тип и идентификатор ВМЕСТЕ, и такая строка тихо
    // выпала бы из всех списков.
    const onlyType = await failure(() =>
      makeDoc({ type: 'commercial_proposal', counterpartyType: 'organization', leadId })
    );
    expect(onlyType).toContain('Document_counterparty_both_or_none');

    const onlyId = await failure(() =>
      makeDoc({ type: 'commercial_proposal', counterpartyId: organizationId, leadId })
    );
    expect(onlyId).toContain('Document_counterparty_both_or_none');
  });

  it('КП без контрагента и без лида — отказ: бумага оказалась бы ни к кому не привязана', async () => {
    // Мутация 3 плана. Без этой проверки КП можно выпустить «в никуда»: ни
    // кабинета, ни карточки, ни способа его найти.
    const msg = await failure(() => makeDoc({ type: 'commercial_proposal' }));
    expect(msg).toContain('Document_proposal_needs_lead');
  });
});

describe('этап 7 PR-1: связи с лидом и сделкой', () => {
  it('лид с выставленным КП не удаляется — отказ по связи, а не по проверке', async () => {
    // Ссылка на лида у КП без контрагента — единственный след адресата.
    // С `SET NULL` удаление лида падало бы на `Document_proposal_needs_lead`:
    // формально тоже отказ, но по сообщению непонятно, что делать. `RESTRICT`
    // отвечает по делу — «сначала разберись с предложением».
    // Проверяем именно формулировку «нарушена внешняя связь»: она и доказывает,
    // что сработал `RESTRICT`, а не проверка. Отрицательную проверку («в тексте
    // нет имени проверки») писать нельзя — Prisma подмешивает в сообщение кусок
    // исходника теста вместе с комментариями, и она бы совпала сама с собой.
    const msg = await failure(() => prisma.lead.delete({ where: { id: leadId } }));
    expect(msg).toContain('Foreign key constraint violated');
    expect(msg).toContain('Document_leadId_fkey');
  });

  it('сделку удалить можно: КП остаётся, ссылка на сделку обнуляется', async () => {
    // Сделка — рамка переговоров, а не адресат: её исчезновение бумагу не
    // обесценивает.
    const id = await makeDoc({ type: 'commercial_proposal', leadId, dealId });
    const temp = (await prisma.deal.create({ data: { companyId, title: `${T}-времянка` } })).id;
    await prisma.document.update({ where: { id }, data: { dealId: temp } });
    await prisma.deal.delete({ where: { id: temp } });
    const saved = await prisma.document.findUniqueOrThrow({
      where: { id },
      select: { dealId: true, leadId: true },
    });
    expect(saved).toEqual({ dealId: null, leadId });
  });
});

describe('этап 7 PR-1: новые поля со значениями по умолчанию', () => {
  it('строка документа по умолчанию считается ценой С НДС', async () => {
    // Мутация 4 плана. Так считал генератор до этапа 7 и так считает
    // `lineMath`; поменяй значение по умолчанию — и суммы уже выпущенных
    // документов разъедутся ровно на ставку налога.
    const id = await makeDoc({ type: 'commercial_proposal', leadId });
    const line = await prisma.documentLine.create({
      data: {
        documentId: id,
        title: 'Обучение',
        quantity: '1',
        unit: 'person',
        unitPrice: '12000.00',
        vatAmount: '2000.00',
        amount: '12000.00',
      } as never,
      select: { vatIncluded: true },
    });
    expect(line.vatIncluded).toBe(true);
  });

  it('срок действия КП у компании по умолчанию — 14 дней', async () => {
    const co = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { proposalValidDays: true },
    });
    expect(co.proposalValidDays).toBe(14);
  });

  it('поля отказа клиента и срока действия пустые у свежего КП', async () => {
    // `У-164`: отказ клиента — не то же самое, что аннулирование сотрудником
    // (`supersededAt`). Поля заводятся отдельными и по умолчанию пустые.
    const id = await makeDoc({ type: 'commercial_proposal', leadId });
    const saved = await prisma.document.findUniqueOrThrow({
      where: { id },
      select: { validUntil: true, rejectedAt: true, rejectReason: true, supersededAt: true },
    });
    expect(saved).toEqual({
      validUntil: null,
      rejectedAt: null,
      rejectReason: null,
      supersededAt: null,
    });
  });
});
