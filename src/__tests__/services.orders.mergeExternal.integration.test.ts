/**
 * «Это тот же заказ, что …» — объединение заказа из Битрикс24 с заказом 1С
 * (этап 2 ТЗ 12.09.2026, `У-197`, `В-2-4`, спека §3.5).
 *
 * Живой Postgres намеренно: сервис переносит шесть разных связей одной
 * транзакцией и удаляет заказ-дубль. На моках «переехало» не отличить от
 * «сделали вид»: внешние ключи, `@unique` на сделке и отказ удалять заказ с
 * жёсткими связями существуют только в базе. Отказы тоже считаются по базе —
 * каждый по своей связи, чтобы человек видел причину, а не «не удалось».
 *
 * Запуск: npx vitest run --mode=integration services.orders.mergeExternal
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  isBitrixOrder,
  listMergeTargets,
  mergeExternalOrderInto,
} from '@/lib/services/orders/mergeExternal';

let prisma: PrismaClient;
const S = Date.now();

let adminId: string;
let leaderAId: string;
let leaderBId: string;
let managerId: string;

let coA: string;
let coB: string;
let partnerId: string;
let orgA1: string;
let orgA2: string;
let orgB1: string;

let contactSrc: string;
let contactDst: string;
let studentId: string;
let directionId: string;

function sess(
  userId: string,
  role: SessionPayload['role'],
  companyId: string | null = null
): SessionPayload {
  return { sub: userId, role, companyId };
}

let admin: SessionPayload;
/** Администратор числится в другой компании: по Model A он ведёт всю систему. */
let adminOfOtherCompany: SessionPayload;
let leaderA: SessionPayload;
let leaderB: SessionPayload;
let manager: SessionPayload;

let seq = 0;

type OrderOver = {
  companyId?: string;
  organizationId?: string;
  externalId?: string | null;
  orderNumber?: string | null;
  primaryContactId?: string | null;
  totalAmount?: number;
  closedAt?: Date | null;
  completedAt?: Date | null;
  title?: string;
};

/** Заказ с говорящим названием: по нему же идёт уборка в конце прогона. */
async function mkOrder(over: OrderOver = {}): Promise<string> {
  seq += 1;
  const row = await prisma.order.create({
    data: {
      title: over.title ?? `MEO-Order-${S}-${seq}`,
      companyId: over.companyId ?? coA,
      organizationId: over.organizationId ?? orgA1,
      externalId: over.externalId === undefined ? null : over.externalId,
      orderNumber: over.orderNumber === undefined ? `MEO-${S}-${seq}` : over.orderNumber,
      primaryContactId: over.primaryContactId ?? null,
      totalAmount: over.totalAmount ?? 0,
      closedAt: over.closedAt ?? null,
      completedAt: over.completedAt ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

/** Заказ-история, заведённая миграцией из Битрикс24 (`У-190`: ключ, не поле). */
function mkBitrixOrder(over: OrderOver = {}): Promise<string> {
  seq += 1;
  return mkOrder({ externalId: `bitrix:DEAL:${S}-${seq}`, ...over });
}

/** Настоящий заказ из 1С — цель объединения. */
function mkOneCOrder(over: OrderOver = {}): Promise<string> {
  seq += 1;
  return mkOrder({ externalId: `1c:${S}-${seq}`, ...over });
}

/**
 * Документ заказа: контрагент обязателен (ограничение
 * `Document_counterparty_required_unless_proposal`), а компания документа не
 * может разойтись с компанией заказа (составной внешний ключ `У-151`).
 */
function mkDocument(name: string, orderId: string): Promise<{ id: string }> {
  return prisma.document.create({
    data: {
      name,
      path: name,
      mimeType: 'application/pdf',
      companyId: coA,
      orderId,
      counterpartyType: 'organization',
      counterpartyId: orgA1,
    },
    select: { id: true },
  });
}

/**
 * Своя организация на тест. Список кандидатов режется двадцатью строками, и
 * заказы соседних тестов вытеснили бы проверяемые: изоляция здесь — часть
 * проверки, а не косметика.
 */
async function freshOrg(label: string): Promise<string> {
  seq += 1;
  const row = await prisma.organization.create({
    data: { name: `MEO-Org-${label}-${S}-${seq}`, partnerId, companyId: coA },
    select: { id: true },
  });
  return row.id;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  coA = (await prisma.company.create({ data: { name: `MEO-Co-A-${S}` } })).id;
  coB = (await prisma.company.create({ data: { name: `MEO-Co-B-${S}` } })).id;

  const mk = (email: string, role: string, name: string, companyId: string | null) =>
    prisma.user.create({
      data: { email, passwordHash: 'x', name, role: role as 'admin', companyId },
    });

  adminId = (await mk(`meo-admin-${S}@t.local`, 'admin', 'MEO Admin', coA)).id;
  leaderAId = (await mk(`meo-leader-a-${S}@t.local`, 'leader', 'MEO Leader A', coA)).id;
  leaderBId = (await mk(`meo-leader-b-${S}@t.local`, 'leader', 'MEO Leader B', coB)).id;
  managerId = (await mk(`meo-manager-${S}@t.local`, 'manager', 'MEO Manager', coA)).id;

  admin = sess(adminId, 'admin', coA);
  adminOfOtherCompany = sess(adminId, 'admin', coB);
  leaderA = sess(leaderAId, 'leader', coA);
  leaderB = sess(leaderBId, 'leader', coB);
  manager = sess(managerId, 'manager', coA);

  partnerId = (await prisma.partner.create({ data: { name: `MEO-P-${S}`, commissionRate: 0.1 } }))
    .id;

  const mkOrg = (name: string, companyId: string) =>
    prisma.organization.create({ data: { name, partnerId, companyId } });
  orgA1 = (await mkOrg(`MEO-Org-A1-${S}`, coA)).id;
  orgA2 = (await mkOrg(`MEO-Org-A2-${S}`, coA)).id;
  orgB1 = (await mkOrg(`MEO-Org-B1-${S}`, coB)).id;

  const mkContact = (name: string) =>
    prisma.contact.create({ data: { name, companyId: coA, organizationId: orgA1 } });
  contactSrc = (await mkContact(`MEO-Contact-Src-${S}`)).id;
  contactDst = (await mkContact(`MEO-Contact-Dst-${S}`)).id;

  studentId = (
    await prisma.student.create({
      data: { name: `MEO-Student-${S}`, organizationId: orgA1 },
    })
  ).id;
  directionId = (await prisma.trainingDirection.create({ data: { name: `MEO-Dir-${S}` } })).id;
});

afterAll(async () => {
  // Часть заказов названа по-человечески (подпись кандидата проверяется
  // дословно), поэтому убираем не по названию заказа, а по организации.
  const ourOrderWhere = {
    OR: [{ title: { startsWith: 'MEO-' } }, { organization: { name: { startsWith: 'MEO-Org' } } }],
  };
  const ourOrders = { order: ourOrderWhere };
  await prisma.auditLog.deleteMany({
    where: { userId: { in: [adminId, leaderAId, leaderBId, managerId] } },
  });
  await prisma.commissionStatementItem.deleteMany({
    where: { organizationName: { startsWith: 'MEO-' } },
  });
  await prisma.commissionStatement.deleteMany({ where: { partnerId } });
  await prisma.comment.deleteMany({ where: { body: { startsWith: 'MEO-' } } });
  await prisma.upload.deleteMany({ where: { filename: { startsWith: 'MEO-' } } });
  await prisma.orderThread.deleteMany({ where: ourOrders });
  await prisma.payment.deleteMany({ where: { note: { startsWith: 'MEO-' } } });
  await prisma.document.deleteMany({ where: ourOrders });
  await prisma.document.deleteMany({ where: { name: { startsWith: 'MEO-' } } });
  await prisma.calendarEvent.deleteMany({ where: { title: { startsWith: 'MEO-' } } });
  await prisma.task.deleteMany({ where: { title: { startsWith: 'MEO-' } } });
  await prisma.dealNote.deleteMany({ where: { body: { startsWith: 'MEO-' } } });
  await prisma.lead.deleteMany({ where: { clientCompanyName: { startsWith: 'MEO-' } } });
  await prisma.deal.deleteMany({ where: { title: { startsWith: 'MEO-' } } });
  await prisma.order.deleteMany({ where: ourOrderWhere });
  await prisma.student.deleteMany({ where: { name: { startsWith: 'MEO-' } } });
  await prisma.trainingDirection.deleteMany({ where: { name: { startsWith: 'MEO-' } } });
  await prisma.contact.deleteMany({ where: { name: { startsWith: 'MEO-' } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'MEO-Org' } } });
  await prisma.partner.deleteMany({ where: { name: { startsWith: 'MEO-P' } } });
  await prisma.user.deleteMany({ where: { email: { contains: 'meo-' } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: 'MEO-Co' } } });
  await prisma.$disconnect();
});

// ─── Опознание заказа Битрикса ───────────────────────────────────────────────

describe('isBitrixOrder — заказ опознаётся по ключу, отдельного признака нет (`У-190`)', () => {
  it.each([
    ['ключ Битрикса', 'bitrix:DEAL:7', true],
    ['ключ 1С', '1c:0000123', false],
    ['внешнего ключа нет', null, false],
    ['ключ лишь похож', 'bitrix-7', false],
  ])('%s → %s', (_name, externalId, expected) => {
    expect(isBitrixOrder({ externalId })).toBe(expected);
  });
});

// ─── Счастливый путь ─────────────────────────────────────────────────────────

describe('mergeExternalOrderInto — всё содержимое переезжает, дубль исчезает', () => {
  it('сделка, документы, задачи, заметки и события переходят на заказ 1С; исходный удалён; аудит записан', async () => {
    const source = await mkBitrixOrder({ primaryContactId: contactSrc, title: `MEO-Src-${S}` });
    const target = await mkOneCOrder({ orderNumber: `MEO-1C-${S}` });

    const [doc1, doc2] = await Promise.all([
      mkDocument(`MEO-Doc-1-${S}`, source),
      mkDocument(`MEO-Doc-2-${S}`, source),
    ]);
    const task = await prisma.task.create({
      data: {
        title: `MEO-Task-${S}`,
        companyId: coA,
        createdById: leaderAId,
        linkedOrderId: source,
      },
      select: { id: true },
    });
    const note = await prisma.dealNote.create({
      data: { body: `MEO-Note-${S}`, orderId: source },
      select: { id: true },
    });
    const deal = await prisma.deal.create({
      data: { title: `MEO-Deal-${S}`, companyId: coA, orderId: source },
      select: { id: true },
    });
    const event = await prisma.calendarEvent.create({
      data: {
        title: `MEO-Event-${S}`,
        companyId: coA,
        createdById: leaderAId,
        startsAt: new Date('2026-09-13T09:00:00Z'),
        linkedOrderId: source,
      },
      select: { id: true },
    });
    const lead = await prisma.lead.create({
      data: {
        clientCompanyName: `MEO-Lead-${S}`,
        clientContactName: 'Пётр',
        subject: 'Обучение',
        createdByUserId: leaderAId,
        promotedOrderId: source,
      },
      select: { id: true },
    });

    const res = await mergeExternalOrderInto(prisma, admin, {
      sourceOrderId: source,
      targetOrderId: target,
    });

    expect(res).toEqual({
      ok: true,
      moved: { documents: 2, tasks: 1, notes: 1, deal: true },
    });

    // Всё, что миграция привязала к своему заказу, теперь на заказе 1С.
    const movedDocs = await prisma.document.findMany({
      where: { id: { in: [doc1.id, doc2.id] } },
      select: { orderId: true },
    });
    expect(movedDocs.map((d) => d.orderId)).toEqual([target, target]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).linkedOrderId).toBe(
      target
    );
    expect((await prisma.dealNote.findUniqueOrThrow({ where: { id: note.id } })).orderId).toBe(
      target
    );
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).orderId).toBe(target);
    expect(
      (await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } })).linkedOrderId
    ).toBe(target);
    // Лид, из которого вырос заказ Битрикса, указывает на настоящий заказ.
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).promotedOrderId).toBe(
      target
    );

    // Дубль исчез, а цель забрала контакт исходного заказа.
    expect(await prisma.order.findUnique({ where: { id: source } })).toBeNull();
    const after = await prisma.order.findUniqueOrThrow({
      where: { id: target },
      select: { primaryContactId: true },
    });
    expect(after.primaryContactId).toBe(contactSrc);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'order_merged_into', entityId: target },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entity).toBe('order');
    expect(audit?.userId).toBe(adminId);
    expect(audit?.meta).toMatchObject({
      status: 'success',
      before: { sourceOrderId: source, sourceTitle: `MEO-Src-${S}` },
      after: {
        targetOrderId: target,
        targetNumber: `MEO-1C-${S}`,
        moved: { documents: 2, tasks: 1, notes: 1, deal: true, events: 1 },
      },
    });
  });

  it('пустой заказ-история переезжает без связей: всё по нулям, сделки нет', async () => {
    const source = await mkBitrixOrder();
    const target = await mkOneCOrder({ orderNumber: null });

    const res = await mergeExternalOrderInto(prisma, admin, {
      sourceOrderId: source,
      targetOrderId: target,
    });

    expect(res).toEqual({
      ok: true,
      moved: { documents: 0, tasks: 0, notes: 0, deal: false },
    });
    expect(await prisma.order.findUnique({ where: { id: source } })).toBeNull();

    // У заказа 1С может не быть номера — в журнал тогда уходит внешний ключ,
    // иначе в истории осталось бы «объединён с null».
    const targetRow = await prisma.order.findUniqueOrThrow({
      where: { id: target },
      select: { externalId: true },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'order_merged_into', entityId: target },
    });
    expect(audit.meta).toMatchObject({ after: { targetNumber: targetRow.externalId } });
  });
});

// ─── Контакт заказа ──────────────────────────────────────────────────────────

describe('mergeExternalOrderInto — контакт переносится только в пустое место', () => {
  it('у цели контакта нет — забирает контакт заказа Битрикса', async () => {
    const source = await mkBitrixOrder({ primaryContactId: contactSrc });
    const target = await mkOneCOrder({ primaryContactId: null });

    expect(
      await mergeExternalOrderInto(prisma, admin, {
        sourceOrderId: source,
        targetOrderId: target,
      })
    ).toMatchObject({ ok: true });

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: target },
      select: { primaryContactId: true },
    });
    expect(after.primaryContactId).toBe(contactSrc);
  });

  it('у цели контакт уже выбран — остаётся свой: живое значение затирать нечем', async () => {
    const source = await mkBitrixOrder({ primaryContactId: contactSrc });
    const target = await mkOneCOrder({ primaryContactId: contactDst });

    expect(
      await mergeExternalOrderInto(prisma, admin, {
        sourceOrderId: source,
        targetOrderId: target,
      })
    ).toMatchObject({ ok: true });

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: target },
      select: { primaryContactId: true },
    });
    expect(after.primaryContactId).toBe(contactDst);
  });

  it('у заказа Битрикса контакта не было — у цели по-прежнему пусто', async () => {
    const source = await mkBitrixOrder({ primaryContactId: null });
    const target = await mkOneCOrder({ primaryContactId: null });

    expect(
      await mergeExternalOrderInto(prisma, admin, {
        sourceOrderId: source,
        targetOrderId: target,
      })
    ).toMatchObject({ ok: true });

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: target },
      select: { primaryContactId: true },
    });
    expect(after.primaryContactId).toBeNull();
  });
});

// ─── Отказы: кто и что объединять нельзя ─────────────────────────────────────

describe('mergeExternalOrderInto — отказы по существу заказов', () => {
  it('тот же заказ — same_order, до базы дело не доходит', async () => {
    const source = await mkBitrixOrder();

    expect(
      await mergeExternalOrderInto(prisma, admin, {
        sourceOrderId: source,
        targetOrderId: source,
      })
    ).toEqual({ ok: false, error: 'same_order' });
  });

  it('исходного заказа нет — not_found', async () => {
    const target = await mkOneCOrder();

    expect(
      await mergeExternalOrderInto(prisma, admin, {
        sourceOrderId: `нет-такого-${S}`,
        targetOrderId: target,
      })
    ).toEqual({ ok: false, error: 'not_found' });
  });

  it('целевого заказа нет — not_found, заказ Битрикса цел', async () => {
    const source = await mkBitrixOrder();

    expect(
      await mergeExternalOrderInto(prisma, admin, {
        sourceOrderId: source,
        targetOrderId: `нет-такого-${S}`,
      })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(await prisma.order.findUnique({ where: { id: source } })).not.toBeNull();
  });

  it('заказы разных компаний — not_found: чужой заказ не должен даже опознаваться', async () => {
    const source = await mkBitrixOrder({ companyId: coA, organizationId: orgA1 });
    const target = await mkOneCOrder({ companyId: coB, organizationId: orgB1 });

    expect(
      await mergeExternalOrderInto(prisma, admin, {
        sourceOrderId: source,
        targetOrderId: target,
      })
    ).toEqual({ ok: false, error: 'not_found' });
  });

  it('исходный заказ не из Битрикса — not_bitrix_order', async () => {
    const source = await mkOneCOrder();
    const target = await mkOneCOrder();

    expect(
      await mergeExternalOrderInto(prisma, admin, {
        sourceOrderId: source,
        targetOrderId: target,
      })
    ).toEqual({ ok: false, error: 'not_bitrix_order' });
  });

  it('заказ без внешнего ключа тоже не заказ Битрикса', async () => {
    const source = await mkOrder({ externalId: null });
    const target = await mkOneCOrder();

    expect(
      await mergeExternalOrderInto(prisma, admin, {
        sourceOrderId: source,
        targetOrderId: target,
      })
    ).toEqual({ ok: false, error: 'not_bitrix_order' });
  });

  it('целевой заказ тоже из Битрикса — target_is_bitrix', async () => {
    const source = await mkBitrixOrder();
    const target = await mkBitrixOrder();

    expect(
      await mergeExternalOrderInto(prisma, admin, {
        sourceOrderId: source,
        targetOrderId: target,
      })
    ).toEqual({ ok: false, error: 'target_is_bitrix' });
  });

  it('заказы разных организаций одной компании — other_organization', async () => {
    const source = await mkBitrixOrder({ organizationId: orgA1 });
    const target = await mkOneCOrder({ organizationId: orgA2 });

    expect(
      await mergeExternalOrderInto(prisma, admin, {
        sourceOrderId: source,
        targetOrderId: target,
      })
    ).toEqual({ ok: false, error: 'other_organization' });
  });
});

describe('mergeExternalOrderInto — отказы по содержимому заказа Битрикса', () => {
  async function pair(): Promise<{ source: string; target: string }> {
    return { source: await mkBitrixOrder(), target: await mkOneCOrder() };
  }

  async function expectBlocked(source: string, target: string, error: string) {
    expect(
      await mergeExternalOrderInto(prisma, admin, {
        sourceOrderId: source,
        targetOrderId: target,
      })
    ).toEqual({ ok: false, error });
    // Отказ обязан быть полным: заказ на месте, ничего не переехало.
    expect(await prisma.order.findUnique({ where: { id: source } })).not.toBeNull();
  }

  it('есть оплата — has_payments', async () => {
    const { source, target } = await pair();
    await prisma.payment.create({
      data: {
        organizationId: orgA1,
        orderId: source,
        amount: 100,
        paidAt: new Date(),
        note: `MEO-Pay-${S}`,
      },
    });

    await expectBlocked(source, target, 'has_payments');
  });

  it('есть строка заказа — has_lines', async () => {
    const { source, target } = await pair();
    await prisma.orderLine.create({
      data: {
        orderId: source,
        title: `MEO-Line-${S}`,
        quantity: 1,
        unit: 'person',
        unitPrice: 100,
        amount: 100,
      },
    });

    await expectBlocked(source, target, 'has_lines');
  });

  it('есть слушатель (позиция заказа) — тоже has_lines', async () => {
    const { source, target } = await pair();
    await prisma.orderItem.create({ data: { orderId: source, studentId, directionId } });

    await expectBlocked(source, target, 'has_lines');
  });

  it('есть комментарий — has_activity', async () => {
    const { source, target } = await pair();
    await prisma.comment.create({
      data: { body: `MEO-Comment-${S}`, orderId: source, authorId: leaderAId },
    });

    await expectBlocked(source, target, 'has_activity');
  });

  it('есть загрузка — has_activity', async () => {
    const { source, target } = await pair();
    await prisma.upload.create({
      data: { filename: `MEO-Upload-${S}`, path: 'u1', size: 10, orderId: source },
    });

    await expectBlocked(source, target, 'has_activity');
  });

  it('есть тред переписки — has_activity', async () => {
    const { source, target } = await pair();
    await prisma.orderThread.create({ data: { orderId: source, side: 'org' } });

    await expectBlocked(source, target, 'has_activity');
  });

  it('есть строка ведомости комиссии — has_activity', async () => {
    const { source, target } = await pair();
    const statement = await prisma.commissionStatement.create({
      data: {
        partnerId,
        periodFrom: new Date('2026-09-01T00:00:00Z'),
        periodTo: new Date('2026-09-30T00:00:00Z'),
      },
      select: { id: true },
    });
    await prisma.commissionStatementItem.create({
      data: {
        statementId: statement.id,
        orderId: source,
        organizationName: `MEO-Stmt-${S}`,
        baseAmount: 100,
        rate: 0.1,
        commissionAmount: 10,
      },
    });

    await expectBlocked(source, target, 'has_activity');
  });

  it('у заказа 1С уже есть своя сделка — target_has_deal', async () => {
    const { source, target } = await pair();
    await prisma.deal.create({
      data: { title: `MEO-Deal-Target-${S}`, companyId: coA, orderId: target },
    });

    await expectBlocked(source, target, 'target_has_deal');
  });
});

// ─── Права ───────────────────────────────────────────────────────────────────

describe('mergeExternalOrderInto — кто имеет право объединять', () => {
  it('руководитель своей компании объединяет наравне с администратором', async () => {
    const source = await mkBitrixOrder({ companyId: coA, organizationId: orgA1 });
    const target = await mkOneCOrder({ companyId: coA, organizationId: orgA1 });

    const res = await mergeExternalOrderInto(prisma, leaderA, {
      sourceOrderId: source,
      targetOrderId: target,
    });

    expect(res).toMatchObject({ ok: true });
    expect(await prisma.order.findUnique({ where: { id: source } })).toBeNull();
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'order_merged_into', entityId: target },
    });
    expect(audit.userId).toBe(leaderAId);
  });

  it('администратор ведёт всю систему (Model A): чужая компания ему не помеха', async () => {
    // Администратор числится в компании B, а заказы — компании A. Границы
    // компании у админа нет: иначе он не смог бы вести систему целиком.
    const source = await mkBitrixOrder({ companyId: coA, organizationId: orgA1 });
    const target = await mkOneCOrder({ companyId: coA, organizationId: orgA1 });

    expect(
      await mergeExternalOrderInto(prisma, adminOfOtherCompany, {
        sourceOrderId: source,
        targetOrderId: target,
      })
    ).toMatchObject({ ok: true });
    expect(await prisma.order.findUnique({ where: { id: source } })).toBeNull();
  });

  it('руководитель чужой компании — «не найден», заказ цел', async () => {
    // Чужая компания не должна даже узнать, что такой заказ существует.
    const source = await mkBitrixOrder({ companyId: coA, organizationId: orgA1 });
    const target = await mkOneCOrder({ companyId: coA, organizationId: orgA1 });

    expect(
      await mergeExternalOrderInto(prisma, leaderB, {
        sourceOrderId: source,
        targetOrderId: target,
      })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(await prisma.order.findUnique({ where: { id: source } })).not.toBeNull();
  });

  it('рядовой менеджер своей компании — forbidden', async () => {
    const source = await mkBitrixOrder();
    const target = await mkOneCOrder();

    expect(
      await mergeExternalOrderInto(prisma, manager, {
        sourceOrderId: source,
        targetOrderId: target,
      })
    ).toEqual({ ok: false, error: 'forbidden' });
  });
});

// ─── Кандидаты для объединения ───────────────────────────────────────────────

describe('listMergeTargets — кандидаты это заказы 1С той же организации', () => {
  it('отдаёт только заказы 1С своей организации: Битрикс, заказ без ключа и чужая организация не в списке', async () => {
    const org = await freshOrg('List');
    const source = await mkBitrixOrder({ organizationId: org });
    const good = await mkOneCOrder({
      organizationId: org,
      orderNumber: `MEO-Good-${S}`,
      title: 'Обучение по ОТ',
      totalAmount: 120000,
      closedAt: new Date('2026-09-01T00:00:00Z'),
    });
    const otherBitrix = await mkBitrixOrder({ organizationId: org });
    const noKey = await mkOrder({ organizationId: org, externalId: null });
    const otherOrg = await mkOneCOrder({ organizationId: orgA2 });
    const otherCompany = await mkOneCOrder({ companyId: coB, organizationId: orgB1 });

    const res = await listMergeTargets(prisma, admin, source);

    expect(res.ok).toBe(true);
    const ids = res.ok ? res.targets.map((t) => t.id) : [];
    expect(ids).toContain(good);
    // Объединять историю с историей незачем, ручной заказ живёт своей жизнью,
    // а чужая организация и чужая компания — это чужие деньги.
    expect(ids).not.toContain(source);
    expect(ids).not.toContain(otherBitrix);
    expect(ids).not.toContain(noKey);
    expect(ids).not.toContain(otherOrg);
    expect(ids).not.toContain(otherCompany);
  });

  it('подпись кандидата — номер и название, под ней сумма и дата закрытия', async () => {
    const org = await freshOrg('Label');
    const source = await mkBitrixOrder({ organizationId: org });
    const withNumber = await mkOneCOrder({
      organizationId: org,
      orderNumber: `MEO-N-${S}`,
      title: 'Аттестация',
      totalAmount: 120000,
      closedAt: new Date('2026-09-02T00:00:00Z'),
    });
    const noNumber = await mkOneCOrder({
      organizationId: org,
      orderNumber: null,
      title: 'Без номера',
      completedAt: new Date('2026-08-01T00:00:00Z'),
    });

    const res = await listMergeTargets(prisma, admin, source);
    expect(res.ok).toBe(true);
    const byId = new Map((res.ok ? res.targets : []).map((t) => [t.id, t]));

    expect(byId.get(withNumber)).toEqual({
      id: withNumber,
      label: `MEO-N-${S} — Аттестация`,
      totalAmount: '120000',
      closedAt: new Date('2026-09-02T00:00:00Z'),
    });
    // Номера нет — подпись берёт внешний ключ; даты закрытия нет — берём
    // дату выполнения, иначе строка выглядела бы «ничем не закончилась».
    const external = (
      await prisma.order.findUniqueOrThrow({
        where: { id: noNumber },
        select: { externalId: true },
      })
    ).externalId;
    expect(byId.get(noNumber)).toEqual({
      id: noNumber,
      label: `${external} — Без номера`,
      totalAmount: '0',
      closedAt: new Date('2026-08-01T00:00:00Z'),
    });
  });

  it('ни даты закрытия, ни даты выполнения — в подписи пусто, а не выдуманная дата', async () => {
    const org = await freshOrg('NoDate');
    const source = await mkBitrixOrder({ organizationId: org });
    const plain = await mkOneCOrder({ organizationId: org });

    const res = await listMergeTargets(prisma, admin, source);
    expect(res.ok).toBe(true);
    const row = (res.ok ? res.targets : []).find((t) => t.id === plain);
    expect(row?.closedAt).toBeNull();
  });

  it('список ограничен двадцатью строками — самыми свежими по дате закрытия', async () => {
    const org = await freshOrg('Cap');
    const source = await mkBitrixOrder({ organizationId: org });
    // 22 заказа 1С: если бы ограничения не было, выбор превратился бы в
    // бесконечную простыню, а сервер отдавал бы всю историю организации.
    await prisma.order.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        title: `MEO-Cap-${S}-${i}`,
        companyId: coA,
        organizationId: org,
        externalId: `1c:cap-${S}-${i}`,
        orderNumber: `MEO-CAP-${i}`,
        closedAt: new Date(Date.UTC(2026, 0, i + 1)),
      })),
    });

    const res = await listMergeTargets(prisma, admin, source);

    expect(res.ok).toBe(true);
    expect(res.ok ? res.targets.length : 0).toBe(20);
    // Сортировка — свежие сверху: самый поздний заказ обязан быть первым.
    expect(res.ok ? res.targets[0]?.label : '').toContain('MEO-CAP-21');
  });
});

describe('listMergeTargets — отказы', () => {
  it('заказа нет — not_found', async () => {
    expect(await listMergeTargets(prisma, admin, `нет-такого-${S}`)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('заказ не из Битрикса — not_bitrix_order: объединять нечего', async () => {
    const order = await mkOneCOrder();

    expect(await listMergeTargets(prisma, admin, order)).toEqual({
      ok: false,
      error: 'not_bitrix_order',
    });
  });

  it('рядовой менеджер — forbidden', async () => {
    const order = await mkBitrixOrder();

    expect(await listMergeTargets(prisma, manager, order)).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('руководитель чужой компании — «не найден»', async () => {
    // Чужая компания не должна даже узнать, что такой заказ существует.
    const order = await mkBitrixOrder({ companyId: coA, organizationId: orgA1 });

    expect(await listMergeTargets(prisma, leaderB, order)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('администратор чужой компании тоже видит кандидатов (Model A)', async () => {
    const org = await freshOrg('AdminB');
    const source = await mkBitrixOrder({ companyId: coA, organizationId: org });
    const target = await mkOneCOrder({ companyId: coA, organizationId: org });

    const res = await listMergeTargets(prisma, adminOfOtherCompany, source);

    expect(res.ok).toBe(true);
    expect(res.ok ? res.targets.map((t) => t.id) : []).toEqual([target]);
  });

  it('руководитель своей компании видит кандидатов', async () => {
    const org = await freshOrg('Leader');
    const source = await mkBitrixOrder({ companyId: coA, organizationId: org });
    const target = await mkOneCOrder({ companyId: coA, organizationId: org });

    const res = await listMergeTargets(prisma, leaderA, source);

    expect(res.ok).toBe(true);
    expect(res.ok ? res.targets.map((t) => t.id) : []).toContain(target);
  });
});
