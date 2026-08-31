import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { listOrders, listOrdersForExport, getOrder } from '@/lib/services/manager/orders';
import { listDocuments, getDocumentForDownload } from '@/lib/services/manager/documents';
import { setOrderAccountingSigned } from '@/lib/services/manager/orderLifecycle';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { listThreads, markRead } from '@/lib/services/chat/threads';
import { listTaskBoard } from '@/lib/services/tasks/board';
import { updateTask, deleteTask } from '@/lib/services/tasks/tasks';

/**
 * Инвариант #5 (фаза 6, «исполняемое ТЗ») — ИЗОЛЯЦИЯ КОМПАНИЙ.
 *
 * «Пользователь companyA не видит и не может изменить данные companyB» — в
 * ОБОИХ режимах `Company.managerTeamVisibility` (C8, CLAUDE.md §4): при ON
 * граница изоляции — компания, при OFF — персональный 3-way scope; но
 * cross-company deny обязан держаться в обоих режимах, включая руководителя
 * (leader-инвариант C8: «любой заказ СВОЕЙ компании», не чужой).
 *
 * Это СИСТЕМАТИЧЕСКИЙ тест: две зеркальные компании (A/B) с полным набором
 * данных (заказ, документ, тред, задача, организация), и представительный
 * набор сервисных read/write-точек менеджера прогоняется в обоих режимах.
 *
 * ─── Матрица изоляции: что покрыто ГДЕ ───────────────────────────────────────
 *
 * Покрыто ЗДЕСЬ (manager-контур, оба режима teamVisibility ON/OFF):
 *   заказы    read : listOrders, listOrdersForExport, getOrder (+ leader)
 *   заказы    write: setOrderAccountingSigned
 *   документы read : listDocuments, getDocumentForDownload
 *   треды     read : listThreads (chat scopeWhere)
 *   треды     write: markRead (canSeeThread)
 *   финансы   read : getManagerFinanceOverview (managerOrgScope)
 *   задачи    read : listTaskBoard (taskWhereForLevel company-floor)
 *   задачи    write: updateTask, deleteTask (canSeeTask company-floor)
 *
 * Покрыто СУЩЕСТВУЮЩИМИ точечными регрессами (не дублируем):
 *   security.idor-calls.integration.test.ts    — звонки Mango: cross-tenant вызовы
 *   security.idor-comments.integration.test.ts — комментарии org-карточки партнёра
 *   security.idor-inbox.integration.test.ts    — входящие сообщения (intake)
 *   security.partner-commission-idor.integration.test.ts — ведомости чужого партнёра
 *   c3.idor-cross-access.test.ts               — каналы документов partner↔org
 *   services.deal-activity.idor.integration.test.ts    — активность сделок
 *   services.leader-analytics.idor.integration.test.ts — аналитика руководителя
 *   services.staff-chat.isolation.integration.test.ts  — внутренний чат сотрудников
 *   services.tasks.isolation.test.ts           — задачи: полная матрица уровней охвата
 *   services.funnel.isolation.test.ts          — воронка per-company
 *   services.order-less-isolation.test.ts      — вне-заказные документы (company-канал)
 *   services.document-channel-isolation.test.ts— канальная изоляция документов
 *   services.training.isolation.integration.test.ts — обучение/удостоверения
 *   services.manager.teamVisibility*.test.ts   — C8: переключение режима как таковое
 *   f.list-cross-tenant.test.ts                — списки intake/leads cross-tenant
 *
 * Намеренно НЕ здесь: лиды — single-tenant командная очередь БЕЗ companyId
 * (решение заказчика, см. services/manager/leads.ts) — понятие «чужая компания»
 * к ним неприменимо; их охват по профилю закреплён в invariants.legacy-access-profile
 * и services.tasks.isolation-семействе.
 * ─────────────────────────────────────────────────────────────────────────────
 */

let prisma: PrismaClient;
const STAMP = `inv5-${Date.now()}`;

let companyA: string, companyB: string;
let orgA: string, orgB: string;
let userA: string, userB: string;
let orderA: string, orderB: string;
let docA: string, docB: string;
let threadA: string, threadB: string;
let taskA: string, taskB: string;

/** Сессия менеджера компании A (без кастомного профиля — legacy-путь). */
function managerASession(): SessionPayload {
  return {
    sub: userA,
    role: 'manager',
    companyId: companyA,
    managedOrgIds: [orgA],
  } as SessionPayload;
}

/** Руководитель компании A — leader-инвариант C8 не расширяет за компанию. */
function leaderASession(): SessionPayload {
  return { ...managerASession(), role: 'leader' } as SessionPayload;
}

async function setTeamVisibility(on: boolean) {
  await prisma.company.updateMany({
    where: { id: { in: [companyA, companyB] } },
    data: { managerTeamVisibility: on },
  });
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const cA = await prisma.company.create({ data: { name: `${STAMP}-companyA` } });
  const cB = await prisma.company.create({ data: { name: `${STAMP}-companyB` } });
  companyA = cA.id;
  companyB = cB.id;

  const oA = await prisma.organization.create({
    data: { name: `${STAMP}-orgA`, companyId: companyA },
  });
  const oB = await prisma.organization.create({
    data: { name: `${STAMP}-orgB`, companyId: companyB },
  });
  orgA = oA.id;
  orgB = oB.id;

  const uA = await prisma.user.create({
    data: { email: `${STAMP}-a@x.local`, name: 'Менеджер A', role: 'manager', companyId: companyA },
  });
  const uB = await prisma.user.create({
    data: { email: `${STAMP}-b@x.local`, name: 'Менеджер B', role: 'manager', companyId: companyB },
  });
  userA = uA.id;
  userB = uB.id;

  const ordA = await prisma.order.create({
    data: {
      title: `${STAMP}-orderA`,
      companyId: companyA,
      organizationId: orgA,
      managerId: userA,
      totalAmount: 100000,
      financialStatus: 'billed',
    },
  });
  const ordB = await prisma.order.create({
    data: {
      title: `${STAMP}-orderB`,
      companyId: companyB,
      organizationId: orgB,
      managerId: userB,
      totalAmount: 200000,
      financialStatus: 'billed',
    },
  });
  orderA = ordA.id;
  orderB = ordB.id;

  // `У-151`: компания у документа обязательна и у документа заказа обязана
  // совпадать с компанией заказа — здесь это ещё и суть сценария: docA/docB
  // должны лежать РОВНО в тех компаниях, изоляцию которых проверяют тесты.
  const dA = await prisma.document.create({
    data: {
      name: `${STAMP}-docA.pdf`,
      path: `x/${STAMP}/a.pdf`,
      mimeType: 'application/pdf',
      orderId: orderA,
      companyId: companyA,
      counterpartyType: 'organization',
      counterpartyId: orgA,
      scanStatus: 'clean',
    },
  });
  const dB = await prisma.document.create({
    data: {
      name: `${STAMP}-docB.pdf`,
      path: `x/${STAMP}/b.pdf`,
      mimeType: 'application/pdf',
      orderId: orderB,
      companyId: companyB,
      counterpartyType: 'organization',
      counterpartyId: orgB,
      scanStatus: 'clean',
    },
  });
  docA = dA.id;
  docB = dB.id;

  const tA = await prisma.orderThread.create({ data: { orderId: orderA, side: 'org' } });
  const tB = await prisma.orderThread.create({ data: { orderId: orderB, side: 'org' } });
  threadA = tA.id;
  threadB = tB.id;

  const taA = await prisma.task.create({
    data: { companyId: companyA, createdById: userA, title: `${STAMP}-taskA` },
  });
  const taB = await prisma.task.create({
    data: { companyId: companyB, createdById: userB, title: `${STAMP}-taskB` },
  });
  taskA = taA.id;
  taskB = taB.id;
});

afterAll(async () => {
  await prisma.threadReadState.deleteMany({ where: { threadId: { in: [threadA, threadB] } } });
  await prisma.orderThread.deleteMany({ where: { id: { in: [threadA, threadB] } } });
  await prisma.task.deleteMany({ where: { id: { in: [taskA, taskB] } } });
  await prisma.document.deleteMany({ where: { id: { in: [docA, docB] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [userA, userB] } } });
  await prisma.order.deleteMany({ where: { id: { in: [orderA, orderB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

// Один и тот же контракт изоляции обязан держаться в обоих режимах C8.
describe.each([
  { mode: 'OFF (персональный 3-way scope)', on: false },
  { mode: 'ON (граница — компания)', on: true },
])('Инвариант: изоляция компаний при managerTeamVisibility=$mode', ({ on }) => {
  describe('Заказы', () => {
    it('менеджер companyA видит в списке свой заказ и НЕ видит заказ companyB', async () => {
      await setTeamVisibility(on);
      const { rows } = await listOrders(prisma, { session: managerASession() });
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(orderA); // позитивный контроль — фильтр не «пустой»
      expect(ids).not.toContain(orderB);
    });

    it('выгрузка заказов (export) собирается той же выборкой — заказа companyB в ней нет', async () => {
      await setTeamVisibility(on);
      const { rows } = await listOrdersForExport(prisma, { session: managerASession() });
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(orderA);
      expect(ids).not.toContain(orderB);
    });

    it('деталь чужого заказа не открывается (null, без утечки существования)', async () => {
      await setTeamVisibility(on);
      expect(await getOrder(prisma, managerASession(), orderB)).toBeNull();
      expect(await getOrder(prisma, managerASession(), orderA)).not.toBeNull();
    });

    it('даже руководитель (leader) НЕ открывает заказ чужой компании', async () => {
      await setTeamVisibility(on);
      expect(await getOrder(prisma, leaderASession(), orderB)).toBeNull();
      expect(await getOrder(prisma, leaderASession(), orderA)).not.toBeNull();
    });

    it('менеджер companyA не может изменить заказ companyB (отметка «бухгалтерия подписана»)', async () => {
      await setTeamVisibility(on);
      const res = await setOrderAccountingSigned(prisma, managerASession(), {
        orderId: orderB,
        signed: true,
      });
      expect(res).toEqual({ ok: false, error: 'forbidden' });
      const after = await prisma.order.findUnique({
        where: { id: orderB },
        select: { accountingSignedAt: true },
      });
      expect(after?.accountingSignedAt).toBeNull(); // запись не изменилась
    });
  });

  describe('Документы', () => {
    it('в списке документов менеджера companyA нет документа companyB', async () => {
      await setTeamVisibility(on);
      const { rows } = await listDocuments(prisma, { session: managerASession() });
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(docA);
      expect(ids).not.toContain(docB);
    });

    it('скачивание документа companyB отклоняется как not_found (тихий отказ)', async () => {
      await setTeamVisibility(on);
      expect(await getDocumentForDownload(prisma, managerASession(), docB)).toEqual({
        ok: false,
        error: 'not_found',
      });
      const own = await getDocumentForDownload(prisma, managerASession(), docA);
      expect(own.ok).toBe(true);
    });
  });

  describe('Треды (чат)', () => {
    it('inbox менеджера companyA не содержит тред заказа companyB', async () => {
      await setTeamVisibility(on);
      const res = await listThreads(prisma, managerASession());
      const ids = res.rows.map((r) => r.id);
      expect(ids).toContain(threadA);
      expect(ids).not.toContain(threadB);
    });

    it('менеджер companyA не может пометить прочитанным тред companyB (write deny)', async () => {
      await setTeamVisibility(on);
      expect(await markRead(prisma, managerASession(), threadB)).toEqual({
        ok: false,
        error: 'forbidden',
      });
      expect(await markRead(prisma, managerASession(), threadA)).toEqual({ ok: true });
    });
  });

  describe('Финансы', () => {
    it('финансовая витрина менеджера companyA не содержит организацию companyB', async () => {
      await setTeamVisibility(on);
      const overview = await getManagerFinanceOverview(prisma, managerASession(), {
        teamMode: on,
      });
      const orgIds = overview.sections.map((s) => s.orgId);
      expect(orgIds).toContain(orgA);
      expect(orgIds).not.toContain(orgB);
    });
  });

  describe('Задачи', () => {
    it('доска задач менеджера companyA не содержит задачу companyB', async () => {
      await setTeamVisibility(on);
      const { board } = await listTaskBoard(prisma, managerASession());
      const ids = board.flatMap((c) => c.cards.map((card) => card.id));
      expect(ids).toContain(taskA);
      expect(ids).not.toContain(taskB);
    });

    it('менеджер companyA не может изменить задачу companyB (not_found, без утечки)', async () => {
      await setTeamVisibility(on);
      const res = await updateTask(prisma, managerASession(), taskB, { title: 'Взлом из A' });
      expect(res).toEqual({ ok: false, error: 'not_found' });
      const after = await prisma.task.findUnique({ where: { id: taskB }, select: { title: true } });
      expect(after?.title).toBe(`${STAMP}-taskB`); // запись не изменилась
    });

    it('менеджер companyA не может удалить задачу companyB', async () => {
      await setTeamVisibility(on);
      const res = await deleteTask(prisma, managerASession(), taskB);
      expect(res).toEqual({ ok: false, error: 'not_found' });
      expect(await prisma.task.findUnique({ where: { id: taskB } })).not.toBeNull();
    });
  });
});
