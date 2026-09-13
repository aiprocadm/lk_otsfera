import { describe, expect, it, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

// Очередь мокается целиком: `requestRollback` отдаёт работу воркеру, а живой
// Redis тесту не нужен. `add` ОБЯЗАН вернуть обещание — боевой код вешает на
// него `.catch`, и мок, отдающий `undefined`, ронял бы запрос отката там, где
// очередь просто недоступна.
const { queueAdd, getQueue } = vi.hoisted(() => {
  const queueAdd = vi.fn(async () => undefined);
  return { queueAdd, getQueue: vi.fn(() => ({ add: queueAdd })) };
});
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

import {
  computeRollbackConflicts,
  requestRollback,
  restoreData,
  rollbackStateOf,
  runRollback,
  type RollbackProgress,
} from '@/lib/services/bitrix/rollback';
import type { SessionPayload } from '@/lib/auth/jwt';
import type { BitrixEntity } from '@/lib/services/bitrix/mapping/types';

/**
 * Откат пакета миграции из Битрикс24 (`У-196`, спека §3.6) на живой Postgres.
 *
 * Проверяется то, ради чего откат и написан: «вернуть как было» обязано
 * вернуть РОВНО как было, а всё, что люди наработали поверх перенесённых
 * строк, — остаться на месте. Поэтому почти каждый сценарий здесь — пара:
 * чистая строка откатывается, строка с чужой работой попадает в конфликты и
 * НЕ трогается.
 *
 * Данные заводятся руками (писатели пакета — отдельная история): журнал
 * `BitrixImportWrite` и есть вход отката, и подделать его точнее, чем прогоном
 * всего конвейера, — единственный способ проверить краевые случаи.
 */
let prisma: PrismaClient;
const STAMP = Date.now();
/** Префикс для всех глобально уникальных колонок — `bitrixId` уникален НА ВСЮ базу. */
const PREFIX = `rbk-${STAMP}-`;
const bx = (suffix: string): string => `${PREFIX}${suffix}`;

const ids = { company: '', company2: '', user: '' };

/** Сессия администратора своей компании. */
const session = (): SessionPayload => ({ sub: ids.user, role: 'admin', companyId: ids.company });

/** Строка журнала в том виде, в каком её ждёт `computeRollbackConflicts`. */
type CreatedRow = Parameters<typeof computeRollbackConflicts>[2][number];

const createdRow = (entity: BitrixEntity, entityId: string): CreatedRow => ({
  id: `journal-${entityId}`,
  entity,
  entityId,
  bitrixId: bx(entityId),
  action: 'created',
  before: null,
  after: null,
});

// ──────────────────────────── помощники данных ────────────────────────────

let seq = 0;
const next = (): string => `${(seq += 1)}`;

async function createBatch(
  over: { status?: string; appliedAt?: Date | null; companyId?: string } = {}
): Promise<string> {
  const batch = await prisma.bitrixImportBatch.create({
    data: {
      companyId: over.companyId ?? ids.company,
      importedById: ids.user,
      source: 'rest',
      status: over.status ?? 'applied',
      appliedAt: over.appliedAt === undefined ? new Date() : over.appliedAt,
      settings: {},
      counts: {},
    },
    select: { id: true },
  });
  return batch.id;
}

async function journal(row: {
  batchId: string;
  entity: BitrixEntity;
  entityId: string;
  action: 'created' | 'updated' | 'linked';
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}): Promise<string> {
  const created = await prisma.bitrixImportWrite.create({
    data: {
      batchId: row.batchId,
      entity: row.entity,
      entityId: row.entityId,
      bitrixId: bx(`w${next()}`),
      action: row.action,
      ...(row.before ? { before: row.before as unknown as Prisma.InputJsonValue } : {}),
      ...(row.after ? { after: row.after as unknown as Prisma.InputJsonValue } : {}),
    },
    select: { id: true },
  });
  return created.id;
}

const newOrg = async (name: string): Promise<string> =>
  (
    await prisma.organization.create({
      data: { name, companyId: ids.company },
      select: { id: true },
    })
  ).id;

const newOrder = async (organizationId: string, title: string, number: string): Promise<string> =>
  (
    await prisma.order.create({
      data: { title, orderNumber: number, companyId: ids.company, organizationId },
      select: { id: true },
    })
  ).id;

const newContact = async (name: string, organizationId?: string): Promise<string> =>
  (
    await prisma.contact.create({
      data: { name, companyId: ids.company, ...(organizationId ? { organizationId } : {}) },
      select: { id: true },
    })
  ).id;

const newDeal = async (title: string, over: { organizationId?: string } = {}): Promise<string> =>
  (
    await prisma.deal.create({
      data: { title, companyId: ids.company, ...over },
      select: { id: true },
    })
  ).id;

const newDoc = async (counterpartyId: string, name: string): Promise<string> =>
  (
    await prisma.document.create({
      data: {
        name,
        path: `bitrix/${bx(name)}`,
        mimeType: 'application/pdf',
        companyId: ids.company,
        counterpartyType: 'organization',
        counterpartyId,
      },
      select: { id: true },
    })
  ).id;

/** Полная уборка данных кабинета в порядке связей (§6: база у тестов общая). */
async function wipe(): Promise<void> {
  await prisma.bitrixImportWrite.deleteMany({
    where: { batch: { companyId: { in: [ids.company, ids.company2] } } },
  });
  // Платёж держит организацию `RESTRICT` — убирается первым.
  await prisma.payment.deleteMany({ where: { organization: { companyId: ids.company } } });
  // Документ держит лид `RESTRICT`, поэтому тоже раньше всех.
  await prisma.document.deleteMany({ where: { companyId: ids.company } });
  await prisma.orderLine.deleteMany({ where: { order: { companyId: ids.company } } });
  await prisma.orderStatusChange.deleteMany({ where: { order: { companyId: ids.company } } });
  await prisma.dealNote.deleteMany({
    where: { OR: [{ deal: { companyId: ids.company } }, { order: { companyId: ids.company } }] },
  });
  await prisma.taskAssignee.deleteMany({ where: { task: { companyId: ids.company } } });
  await prisma.task.deleteMany({ where: { companyId: ids.company } });
  await prisma.messengerDialog.deleteMany({ where: { peerRef: { startsWith: PREFIX } } });
  await prisma.call.deleteMany({ where: { externalId: { startsWith: PREFIX } } });
  await prisma.inboundMessage.deleteMany({ where: { externalId: { startsWith: PREFIX } } });
  await prisma.deal.deleteMany({ where: { companyId: ids.company } });
  await prisma.order.deleteMany({ where: { companyId: ids.company } });
  await prisma.lead.deleteMany({ where: { createdByUserId: ids.user } });
  await prisma.organizationNote.deleteMany({ where: { companyId: ids.company } });
  await prisma.contactChannel.deleteMany({ where: { companyId: ids.company } });
  await prisma.contact.deleteMany({ where: { companyId: ids.company } });
  await prisma.organizationManager.deleteMany({
    where: { organization: { companyId: ids.company } },
  });
  await prisma.organization.deleteMany({ where: { companyId: ids.company } });
  await prisma.bitrixImportBatch.deleteMany({
    where: { companyId: { in: [ids.company, ids.company2] } },
  });
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const company = await prisma.company.create({
    data: { name: `Тест отката Битрикс ${STAMP}` },
    select: { id: true },
  });
  ids.company = company.id;
  const other = await prisma.company.create({
    data: { name: `Чужая компания отката ${STAMP}` },
    select: { id: true },
  });
  ids.company2 = other.id;
  const user = await prisma.user.create({
    data: {
      email: `bitrix-rollback-${STAMP}@test.local`,
      name: 'Администратор отката',
      role: 'admin',
      companyId: company.id,
    },
    select: { id: true },
  });
  ids.user = user.id;
});

beforeEach(async () => {
  vi.clearAllMocks();
  await wipe();
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { id: ids.user } });
  await prisma.company.deleteMany({ where: { id: { in: [ids.company, ids.company2] } } });
  await prisma.$disconnect();
});

// ───────────────────────────── снимок до/после ─────────────────────────────

type OrgShot = {
  name: string;
  nameKey: string | null;
  inn: string | null;
  kpp: string | null;
  bitrixId: string | null;
};

const orgShot = (id: string): Promise<OrgShot> =>
  prisma.organization.findUniqueOrThrow({
    where: { id },
    select: { name: true, nameKey: true, inn: true, kpp: true, bitrixId: true },
  });

async function dealShot(id: string): Promise<Record<string, unknown>> {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id },
    select: {
      title: true,
      amount: true,
      status: true,
      stageId: true,
      organizationId: true,
      contactId: true,
      leadId: true,
      managerId: true,
      expectedCloseAt: true,
      wonAt: true,
      lostAt: true,
      bitrixId: true,
    },
  });
  return { ...deal, amount: deal.amount === null ? null : deal.amount.toString() };
}

describe('runRollback — снимок до и после отката совпадает', () => {
  it('созданное удалено, изменённое вернулось ровно к снимку `before`, журнал закрыт', async () => {
    const batchId = await createBatch();

    // Строки, которые в кабинете БЫЛИ до переноса: их пакет только правил.
    const orgUpd = await newOrg('Организация до переноса');
    await prisma.organization.update({
      where: { id: orgUpd },
      data: { nameKey: 'organizaciya do perenosa' },
    });
    const dealUpd = await newDeal('Сделка до переноса');
    await prisma.deal.update({
      where: { id: dealUpd },
      data: {
        amount: '1000.00',
        status: 'open',
        expectedCloseAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    });

    const orgBefore = await orgShot(orgUpd);
    const dealBefore = await dealShot(dealUpd);

    // Строки, которые ЗАВЁЛ пакет.
    const orgNew = await newOrg('Организация из Битрикс24');
    const contactNew = await newContact('Контакт из Битрикс24', orgNew);
    const leadNew = (
      await prisma.lead.create({
        data: {
          createdByUserId: ids.user,
          organizationId: orgNew,
          clientCompanyName: 'Клиент из Битрикс24',
          clientContactName: 'Иван Петров',
          subject: 'Лид из Битрикс24',
          source: 'bitrix',
          bitrixId: bx('lead'),
        },
        select: { id: true },
      })
    ).id;
    const dealNew = await newDeal('Сделка из Битрикс24', { organizationId: orgNew });
    await prisma.deal.update({ where: { id: dealNew }, data: { leadId: leadNew } });
    const taskNew = (
      await prisma.task.create({
        data: {
          companyId: ids.company,
          title: 'Задача из Битрикс24',
          createdById: ids.user,
          linkedOrganizationId: orgNew,
          linkedDealId: dealNew,
          bitrixId: bx('task'),
        },
        select: { id: true },
      })
    ).id;

    // Перенос «записал» поверх живых строк.
    await prisma.organization.update({
      where: { id: orgUpd },
      data: {
        name: 'ООО «Битрикс»',
        nameKey: 'ooo bitriks',
        inn: String(STAMP).slice(-10),
        kpp: '770101001',
        bitrixId: bx('org-upd'),
      },
    });
    await prisma.deal.update({
      where: { id: dealUpd },
      data: {
        title: 'Сделка после переноса',
        amount: '2500.00',
        status: 'won',
        wonAt: new Date('2026-03-05T09:00:00.000Z'),
        expectedCloseAt: null,
      },
    });

    await journal({ batchId, entity: 'organization', entityId: orgNew, action: 'created' });
    await journal({ batchId, entity: 'contact', entityId: contactNew, action: 'created' });
    await journal({ batchId, entity: 'lead', entityId: leadNew, action: 'created' });
    await journal({ batchId, entity: 'deal', entityId: dealNew, action: 'created' });
    await journal({ batchId, entity: 'task', entityId: taskNew, action: 'created' });
    await journal({
      batchId,
      entity: 'organization',
      entityId: orgUpd,
      action: 'updated',
      before: { ...orgBefore },
    });
    await journal({
      batchId,
      entity: 'deal',
      entityId: dealUpd,
      action: 'updated',
      // Журнал хранит даты строкой ISO — ровно так их кладёт `snapshot()`.
      before: {
        title: dealBefore.title,
        amount: dealBefore.amount,
        status: dealBefore.status,
        wonAt: null,
        expectedCloseAt: '2026-02-01T00:00:00.000Z',
      },
    });

    const summary = await runRollback(prisma, batchId);

    expect(summary).toMatchObject({
      status: 'rolled_back',
      reverted: 7,
      deleted: 5,
      restored: 2,
      unlinked: 0,
    });
    expect(summary.conflicts).toEqual([]);
    expect(summary.errors).toEqual([]);

    // Созданное — удалено.
    expect(await prisma.organization.findUnique({ where: { id: orgNew } })).toBeNull();
    expect(await prisma.contact.findUnique({ where: { id: contactNew } })).toBeNull();
    expect(await prisma.lead.findUnique({ where: { id: leadNew } })).toBeNull();
    expect(await prisma.deal.findUnique({ where: { id: dealNew } })).toBeNull();
    expect(await prisma.task.findUnique({ where: { id: taskNew } })).toBeNull();

    // Изменённое — ровно как было, вплоть до дат и пустых значений.
    expect(await orgShot(orgUpd)).toEqual(orgBefore);
    expect(await dealShot(dealUpd)).toEqual(dealBefore);

    const rows = await prisma.bitrixImportWrite.findMany({
      where: { batchId },
      select: { reverted: true },
    });
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.reverted)).toBe(true);
  });
});

// ──────────────────────────────── конфликты ────────────────────────────────

describe('runRollback — чужая работа поверх переноса не стирается', () => {
  it('заказ с новым платежом остаётся, чистый заказ того же пакета удаляется', async () => {
    const batchId = await createBatch();
    // Организация ЖИВАЯ (не из пакета) — иначе её удаление смешалось бы с проверкой.
    const org = await newOrg('Организация-владелец заказов');
    const stuck = await newOrder(org, 'Заказ с оплатой', 'ЗК-0001');
    const clean = await newOrder(org, 'Заказ без следов', 'ЗК-0002');
    await prisma.payment.create({
      data: { organizationId: org, orderId: stuck, amount: '10000.00', paidAt: new Date() },
    });

    const stuckRow = await journal({
      batchId,
      entity: 'order',
      entityId: stuck,
      action: 'created',
    });
    const cleanRow = await journal({
      batchId,
      entity: 'order',
      entityId: clean,
      action: 'created',
    });

    const summary = await runRollback(prisma, batchId);

    expect(summary.status).toBe('rollback_partial');
    expect(summary.errors).toEqual([]);
    expect(summary.conflicts).toEqual([
      { entity: 'order', entityId: stuck, label: 'ЗК-0001', code: 'order_has_payments', count: 1 },
    ]);

    expect(await prisma.order.findUnique({ where: { id: stuck } })).not.toBeNull();
    expect(await prisma.order.findUnique({ where: { id: clean } })).toBeNull();

    const rows = await prisma.bitrixImportWrite.findMany({
      where: { batchId },
      select: { id: true, reverted: true },
    });
    expect(rows.find((r) => r.id === stuckRow)?.reverted).toBe(false);
    expect(rows.find((r) => r.id === cleanRow)?.reverted).toBe(true);
  });

  it('организацию держат ЧУЖИЕ заказ, контакт и документ', async () => {
    const org = await newOrg('Организация с чужой работой');
    await newOrder(org, 'Заказ, заведённый человеком', 'ЗК-0010');
    await newContact('Контакт, заведённый человеком', org);
    await newDoc(org, 'Договор человека.pdf');

    const { conflicts, blocked } = await computeRollbackConflicts(prisma, 'organization', [
      createdRow('organization', org),
    ]);

    expect(conflicts.map((c) => c.code).sort()).toEqual([
      'organization_has_contacts',
      'organization_has_documents',
      'organization_has_orders',
    ]);
    expect(conflicts.every((c) => c.label === 'Организация с чужой работой')).toBe(true);
    expect([...blocked]).toEqual([org]);
  });

  it('заказ, контакт и документ ИЗ ЭТОГО ЖЕ пакета организацию не держат', async () => {
    const batchId = await createBatch();
    const org = await newOrg('Организация со своими детьми');
    const order = await newOrder(org, 'Заказ из пакета', 'ЗК-0011');
    const contact = await newContact('Контакт из пакета', org);
    const doc = await newDoc(org, 'Файл из пакета.pdf');
    await journal({ batchId, entity: 'order', entityId: order, action: 'created' });
    await journal({ batchId, entity: 'contact', entityId: contact, action: 'created' });
    await journal({ batchId, entity: 'file', entityId: doc, action: 'created' });
    await journal({ batchId, entity: 'organization', entityId: org, action: 'created' });

    // Проверяем полным прогоном, а не точечным вызовом: дети пакета удаляются
    // раньше родителя, и к проверке организации их уже нет. Спрашивать
    // «наш ли ребёнок по журналу» нельзя — заказ, который сам не откатился
    // из-за оплаты, числился бы «нашим», и удаление упало бы по ключу базы.
    const summary = await runRollback(prisma, batchId);

    expect(summary.conflicts).toEqual([]);
    expect(summary.status).toBe('rolled_back');
    expect(await prisma.organization.findUnique({ where: { id: org } })).toBeNull();
    expect(await prisma.order.findUnique({ where: { id: order } })).toBeNull();
    expect(await prisma.contact.findUnique({ where: { id: contact } })).toBeNull();
    expect(await prisma.document.findUnique({ where: { id: doc } })).toBeNull();
  });

  it('дети из ЧУЖОГО пакета организацию держат', async () => {
    const foreign = await createBatch();
    const org = await newOrg('Организация с заказом соседнего пакета');
    const order = await newOrder(org, 'Заказ соседнего пакета', 'ЗК-0012');
    await journal({ batchId: foreign, entity: 'order', entityId: order, action: 'created' });

    const { conflicts } = await computeRollbackConflicts(prisma, 'organization', [
      createdRow('organization', org),
    ]);

    expect(conflicts.map((c) => c.code)).toEqual(['organization_has_orders']);
  });

  it('контакт держат переписка и звонок, чистый контакт удаляется', async () => {
    const batchId = await createBatch();
    const org = await newOrg('Организация контактов');
    const withDialog = await newContact('Контакт с перепиской', org);
    const withInbound = await newContact('Контакт с письмом', org);
    const withCall = await newContact('Контакт со звонком', org);
    const clean = await newContact('Контакт без следов', org);

    await prisma.messengerDialog.create({
      data: {
        channel: 'telegram',
        peerRef: bx('peer'),
        companyId: ids.company,
        contactId: withDialog,
      },
    });
    await prisma.inboundMessage.create({
      data: {
        channel: 'email',
        externalId: bx('inbound'),
        senderRef: 'client@example.com',
        body: 'Здравствуйте!',
        companyId: ids.company,
        contactId: withInbound,
      },
    });
    await prisma.call.create({
      data: {
        externalId: bx('call'),
        direction: 'in',
        callerNumber: '+79990000000',
        status: 'answered',
        companyId: ids.company,
        contactId: withCall,
      },
    });

    for (const id of [withDialog, withInbound, withCall, clean]) {
      await journal({ batchId, entity: 'contact', entityId: id, action: 'created' });
    }

    const summary = await runRollback(prisma, batchId);

    expect(summary.status).toBe('rollback_partial');
    expect(summary.errors).toEqual([]);
    const byId = new Map(summary.conflicts.map((c) => [c.entityId, c.code]));
    expect(byId.get(withDialog)).toBe('contact_has_dialogs');
    expect(byId.get(withInbound)).toBe('contact_has_dialogs');
    expect(byId.get(withCall)).toBe('contact_has_calls');
    expect(byId.has(clean)).toBe(false);

    expect(await prisma.contact.findUnique({ where: { id: withDialog } })).not.toBeNull();
    expect(await prisma.contact.findUnique({ where: { id: withInbound } })).not.toBeNull();
    expect(await prisma.contact.findUnique({ where: { id: withCall } })).not.toBeNull();
    expect(await prisma.contact.findUnique({ where: { id: clean } })).toBeNull();
  });

  it('сделку держит ЧУЖАЯ заметка, своя — не держит', async () => {
    const batchId = await createBatch();
    const foreignNoted = await newDeal('Сделка с заметкой менеджера');
    const ownNoted = await newDeal('Сделка с заметкой пакета');
    await prisma.dealNote.create({
      data: { dealId: foreignNoted, body: 'Позвонить в понедельник', authorId: ids.user },
    });
    const ownNote = (
      await prisma.dealNote.create({
        data: { dealId: ownNoted, body: 'Комментарий из Битрикс24' },
        select: { id: true },
      })
    ).id;
    await journal({ batchId, entity: 'note', entityId: ownNote, action: 'created' });

    await journal({ batchId, entity: 'deal', entityId: foreignNoted, action: 'created' });
    await journal({ batchId, entity: 'deal', entityId: ownNoted, action: 'created' });

    // Снова полным прогоном: заметка пакета удаляется на шаге «Заметки»,
    // раньше сделок, поэтому своя сделка уходит чисто, а чужая заметка держит.
    const summary = await runRollback(prisma, batchId);

    expect(summary.conflicts).toEqual([
      {
        entity: 'deal',
        entityId: foreignNoted,
        label: 'Сделка с заметкой менеджера',
        code: 'deal_has_notes',
        count: 1,
      },
    ]);
    expect(summary.status).toBe('rollback_partial');
    expect(await prisma.deal.findUnique({ where: { id: ownNoted } })).toBeNull();
    expect(await prisma.deal.findUnique({ where: { id: foreignNoted } })).not.toBeNull();
  });

  it('цель изменения удалили руками — конфликт `record_missing`, строка не откатывается', async () => {
    const batchId = await createBatch();
    const gone = await newDeal('Сделка, которую снесли');
    const rowId = await journal({
      batchId,
      entity: 'deal',
      entityId: gone,
      action: 'updated',
      before: { title: 'Название до переноса' },
    });
    await prisma.deal.delete({ where: { id: gone } });

    const summary = await runRollback(prisma, batchId);

    expect(summary.status).toBe('rollback_partial');
    expect(summary.restored).toBe(0);
    expect(summary.conflicts).toEqual([
      { entity: 'deal', entityId: gone, label: gone, code: 'record_missing', count: 1 },
    ]);
    const row = await prisma.bitrixImportWrite.findUniqueOrThrow({
      where: { id: rowId },
      select: { reverted: true },
    });
    expect(row.reverted).toBe(false);
  });
});

// ─────────────────────────────── связь заказа ───────────────────────────────

describe('runRollback — строка `linked` снимает только СВОЮ связь', () => {
  it('сделку отвязывает от того заказа, к которому её привязал пакет', async () => {
    const batchId = await createBatch();
    const org = await newOrg('Организация связей');
    const ours = await newOrder(org, 'Заказ 1С, привязанный пакетом', 'ЗК-0020');
    const dealOurs = await newDeal('Сделка, связь которой наша');
    await prisma.deal.update({ where: { id: dealOurs }, data: { orderId: ours } });

    // Второй случай: пакет привязал сделку к `moved`, а менеджер перекинул её
    // на другой заказ. Его выбор откат трогать не вправе.
    const moved = await newOrder(org, 'Заказ, от которого сделку увели', 'ЗК-0021');
    const another = await newOrder(org, 'Заказ, выбранный менеджером', 'ЗК-0022');
    const dealMoved = await newDeal('Сделка, которую перепривязали');
    await prisma.deal.update({ where: { id: dealMoved }, data: { orderId: another } });

    await journal({
      batchId,
      entity: 'order',
      entityId: ours,
      action: 'linked',
      before: { dealId: dealOurs, orderId: null },
    });
    await journal({
      batchId,
      entity: 'order',
      entityId: moved,
      action: 'linked',
      before: { dealId: dealMoved, orderId: null },
    });

    const summary = await runRollback(prisma, batchId);

    expect(summary).toMatchObject({ status: 'rolled_back', unlinked: 1, deleted: 0, reverted: 2 });
    expect(
      (await prisma.deal.findUniqueOrThrow({ where: { id: dealOurs }, select: { orderId: true } }))
        .orderId
    ).toBeNull();
    expect(
      (await prisma.deal.findUniqueOrThrow({ where: { id: dealMoved }, select: { orderId: true } }))
        .orderId
    ).toBe(another);
    // `linked` не создавал заказ — удалять его откат не имеет права.
    expect(await prisma.order.findUnique({ where: { id: ours } })).not.toBeNull();
    expect(await prisma.order.findUnique({ where: { id: moved } })).not.toBeNull();
  });
});

// ───────────────────────────── белый список полей ─────────────────────────────

describe('restoreData — в базу возвращаются только поля, которые пакет умеет менять', () => {
  it('лишнее поле из снимка отбрасывается молча', () => {
    expect(
      restoreData('organization', {
        name: 'Старое имя',
        companyId: 'чужая-компания',
        somethingElse: 'мусор',
      })
    ).toEqual({ name: 'Старое имя' });
  });

  it('строка-дата превращается в `Date`, а `null` остаётся `null`', () => {
    expect(
      restoreData('deal', { expectedCloseAt: '2026-02-01T00:00:00.000Z', wonAt: null })
    ).toEqual({ expectedCloseAt: new Date('2026-02-01T00:00:00.000Z'), wonAt: null });
  });

  it('у сущности без белого списка (заметка, файл) восстанавливать нечего', () => {
    expect(restoreData('note', { body: 'что угодно' })).toEqual({});
    expect(restoreData('file', { name: 'что угодно' })).toEqual({});
  });

  it('подложенный в журнал `companyId` не уводит организацию в чужую компанию', async () => {
    const batchId = await createBatch();
    const org = await newOrg('Организация до переноса');
    await prisma.organization.update({ where: { id: org }, data: { name: 'Имя из Битрикс24' } });
    await journal({
      batchId,
      entity: 'organization',
      entityId: org,
      action: 'updated',
      before: { name: 'Организация до переноса', companyId: ids.company2 },
    });

    const summary = await runRollback(prisma, batchId);

    expect(summary.status).toBe('rolled_back');
    const saved = await prisma.organization.findUniqueOrThrow({
      where: { id: org },
      select: { name: true, companyId: true },
    });
    expect(saved).toEqual({ name: 'Организация до переноса', companyId: ids.company });
  });
});

// ───────────────────────────────── порционность ─────────────────────────────────

describe('runRollback — пакет больше одной порции', () => {
  it('120 задач откатываются полностью за несколько порций, прогресс сообщается', async () => {
    const batchId = await createBatch();
    const taskIds = Array.from({ length: 120 }, (_, i) => `${PREFIX}task-${i}`);
    await prisma.task.createMany({
      data: taskIds.map((id, i) => ({
        id,
        companyId: ids.company,
        title: `Задача из Битрикс24 №${i}`,
        createdById: ids.user,
        bitrixId: bx(`bulk-task-${i}`),
      })),
    });
    await prisma.bitrixImportWrite.createMany({
      data: taskIds.map((id, i) => ({
        batchId,
        entity: 'task',
        entityId: id,
        bitrixId: bx(`bulk-w-${i}`),
        action: 'created',
      })),
    });

    const progress: RollbackProgress[] = [];
    const onProgress = vi.fn(async (p: RollbackProgress) => {
      progress.push(p);
    });

    const summary = await runRollback(prisma, batchId, onProgress);

    expect(summary).toMatchObject({ status: 'rolled_back', deleted: 120, reverted: 120 });
    expect(await prisma.task.count({ where: { id: { in: taskIds } } })).toBe(0);
    // Порция — 100 строк, значит порций две, и прогресс обязан прийти дважды.
    expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(progress.every((p) => p.entity === 'task')).toBe(true);
    expect(progress.at(-1)?.done).toBe(120);
    expect(await prisma.bitrixImportWrite.count({ where: { batchId, reverted: false } })).toBe(0);
  });
});

// ───────────────────────────── заметки и файлы ─────────────────────────────

describe('runRollback — заметки и файлы', () => {
  it('удаляются обе заметки: и по сделке, и по организации', async () => {
    const batchId = await createBatch();
    const org = await newOrg('Организация заметок');
    const deal = await newDeal('Сделка заметок');
    const dealNote = (
      await prisma.dealNote.create({
        data: { dealId: deal, body: 'Заметка сделки из Битрикс24' },
        select: { id: true },
      })
    ).id;
    const orgNote = (
      await prisma.organizationNote.create({
        data: {
          companyId: ids.company,
          organizationId: org,
          body: 'Заметка организации из Битрикс24',
        },
        select: { id: true },
      })
    ).id;
    await journal({ batchId, entity: 'note', entityId: dealNote, action: 'created' });
    await journal({ batchId, entity: 'note', entityId: orgNote, action: 'created' });

    const summary = await runRollback(prisma, batchId);

    expect(summary).toMatchObject({ status: 'rolled_back', deleted: 2, reverted: 2 });
    expect(await prisma.dealNote.findUnique({ where: { id: dealNote } })).toBeNull();
    expect(await prisma.organizationNote.findUnique({ where: { id: orgNote } })).toBeNull();
  });

  it('строка документа удаляется, соседний документ не трогается', async () => {
    const batchId = await createBatch();
    const org = await newOrg('Организация файлов');
    const ours = await newDoc(org, 'Вложение из Битрикс24.pdf');
    const foreign = await newDoc(org, 'Договор менеджера.pdf');
    await journal({ batchId, entity: 'file', entityId: ours, action: 'created' });

    const summary = await runRollback(prisma, batchId);

    expect(summary).toMatchObject({ status: 'rolled_back', deleted: 1 });
    expect(await prisma.document.findUnique({ where: { id: ours } })).toBeNull();
    expect(await prisma.document.findUnique({ where: { id: foreign } })).not.toBeNull();
  });
});

// ─────────────────────── «Откатить»: когда кнопка работает ───────────────────────

describe('rollbackStateOf — подпись кнопки считается по тем же данным, что и сам откат', () => {
  const now = Date.UTC(2026, 8, 13);
  const day = 24 * 60 * 60 * 1000;

  it('применённый свежий пакет с неоткаченными строками доступен', () => {
    expect(rollbackStateOf({ status: 'applied', appliedAt: new Date(now - day) }, now, 3)).toBe(
      'available'
    );
  });

  it('частично откаченный пакет можно доткатить', () => {
    expect(
      rollbackStateOf({ status: 'rollback_partial', appliedAt: new Date(now - day) }, now, 1)
    ).toBe('available');
  });

  it('неприменённый, откаченный, просроченный и пустой — каждый со своей причиной', () => {
    expect(rollbackStateOf({ status: 'preview', appliedAt: null }, now, 3)).toBe('not_applied');
    expect(rollbackStateOf({ status: 'applied', appliedAt: null }, now, 3)).toBe('not_applied');
    expect(rollbackStateOf({ status: 'rolled_back', appliedAt: new Date(now) }, now, 3)).toBe(
      'rolled_back'
    );
    expect(
      rollbackStateOf({ status: 'applied', appliedAt: new Date(now - 31 * day) }, now, 3)
    ).toBe('expired');
    expect(rollbackStateOf({ status: 'applied', appliedAt: new Date(now - day) }, now, 0)).toBe(
      'nothing_to_revert'
    );
  });
});

describe('requestRollback — проверки до постановки задачи', () => {
  it('сессия без компании — `forbidden`', async () => {
    const batchId = await createBatch();
    const result = await requestRollback(
      prisma,
      { sub: ids.user, role: 'admin', companyId: null },
      batchId
    );
    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('пакет чужой компании — `not_found` (существование чужого пакета не раскрываем)', async () => {
    const batchId = await createBatch({ companyId: ids.company2 });
    await journal({ batchId, entity: 'deal', entityId: 'что-угодно', action: 'created' });

    const result = await requestRollback(prisma, session(), batchId);

    expect(result).toEqual({ ok: false, error: 'not_found' });
    const saved = await prisma.bitrixImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: { status: true },
    });
    expect(saved.status).toBe('applied');
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('несуществующий пакет — `not_found`', async () => {
    const result = await requestRollback(prisma, session(), `${PREFIX}нет-такого`);
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('пакет не применяли — `not_applied`', async () => {
    const batchId = await createBatch({ status: 'preview', appliedAt: null });
    await journal({ batchId, entity: 'deal', entityId: 'что-угодно', action: 'created' });

    expect(await requestRollback(prisma, session(), batchId)).toEqual({
      ok: false,
      error: 'not_applied',
    });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('журнал пуст — `nothing_to_revert`', async () => {
    const batchId = await createBatch();
    expect(await requestRollback(prisma, session(), batchId)).toEqual({
      ok: false,
      error: 'nothing_to_revert',
    });
  });

  it('все строки уже откачены — `nothing_to_revert`', async () => {
    const batchId = await createBatch();
    const rowId = await journal({
      batchId,
      entity: 'deal',
      entityId: 'что-угодно',
      action: 'created',
    });
    await prisma.bitrixImportWrite.update({ where: { id: rowId }, data: { reverted: true } });

    expect(await requestRollback(prisma, session(), batchId)).toEqual({
      ok: false,
      error: 'nothing_to_revert',
    });
  });

  it('пакет старше 30 дней — `expired`', async () => {
    const batchId = await createBatch({
      appliedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    });
    await journal({ batchId, entity: 'deal', entityId: 'что-угодно', action: 'created' });

    expect(await requestRollback(prisma, session(), batchId)).toEqual({
      ok: false,
      error: 'expired',
    });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('успех: пакет уходит в `rolling_back` и задача ставится в очередь', async () => {
    const batchId = await createBatch();
    await journal({ batchId, entity: 'deal', entityId: 'что-угодно', action: 'created' });

    expect(await requestRollback(prisma, session(), batchId)).toEqual({ ok: true });

    const saved = await prisma.bitrixImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: { status: true },
    });
    expect(saved.status).toBe('rolling_back');
    expect(getQueue).toHaveBeenCalledWith('bitrix.import');
    expect(queueAdd).toHaveBeenCalledWith('rollback', { batchId });
  });
});

// ─────────────────────────── найденное расхождение ───────────────────────────

describe('runRollback — чужая работа поверх переноса обязана быть КОНФЛИКТОМ, а не сбоем базы', () => {
  /**
   * Собственное правило модуля: «удалять можно, пока на записи не легло
   * НИЧЕГО, чего не приносил этот же пакет», и такая строка «не откатывается, а
   * попадает в список конфликтов».
   *
   * Три случая ниже это правило нарушают: на записи лежит чужая работа, но
   * `computeRollbackConflicts` про неё не спрашивает, и вместо конфликта откат
   * получает нарушение внешнего ключа. Порция — одна транзакция, поэтому
   * падает не одна строка, а ВСЯ порция: соседние, ни в чём не виноватые
   * строки того же пакета тоже остаются неоткаченными, а человек вместо
   * понятной причины видит текст исключения Prisma.
   *
   * Тесты описывают правильное поведение: конкретная строка — в `conflicts`,
   * соседняя — откачена, сырых ошибок базы нет.
   */
  it('организация с неоткаченным заказом пакета попадает в конфликты, соседняя — откатывается', async () => {
    const batchId = await createBatch();
    const stuckOrg = await newOrg('Организация с застрявшим заказом');
    const cleanOrg = await newOrg('Организация без следов');
    const stuckOrder = await newOrder(stuckOrg, 'Заказ, в который дописали строку', 'ЗК-0030');
    await prisma.orderLine.create({
      data: {
        orderId: stuckOrder,
        title: 'Строка, добавленная менеджером',
        quantity: '1',
        unit: 'service',
        unitPrice: '5000.00',
        amount: '5000.00',
      },
    });

    await journal({ batchId, entity: 'order', entityId: stuckOrder, action: 'created' });
    await journal({ batchId, entity: 'organization', entityId: stuckOrg, action: 'created' });
    await journal({ batchId, entity: 'organization', entityId: cleanOrg, action: 'created' });

    const summary = await runRollback(prisma, batchId);

    // Соседняя организация не виновата в застрявшем заказе — она откачена.
    expect(await prisma.organization.findUnique({ where: { id: cleanOrg } })).toBeNull();
    expect(await prisma.organization.findUnique({ where: { id: stuckOrg } })).not.toBeNull();
    // «На заказе есть строки» — это конфликт, а не сырой сбой базы.
    expect(summary.conflicts.map((c) => c.code).sort()).toEqual([
      'order_has_lines',
      'organization_has_orders',
    ]);
    expect(summary.errors).toEqual([]);
  });

  it('лид с выставленным КП попадает в конфликты, соседний лид откатывается', async () => {
    const batchId = await createBatch();
    const withProposal = (
      await prisma.lead.create({
        data: {
          createdByUserId: ids.user,
          clientCompanyName: 'Клиент с КП',
          clientContactName: 'Пётр Сидоров',
          subject: 'Лид, по которому выставили КП',
        },
        select: { id: true },
      })
    ).id;
    const clean = (
      await prisma.lead.create({
        data: {
          createdByUserId: ids.user,
          clientCompanyName: 'Клиент без следов',
          clientContactName: 'Анна Смирнова',
          subject: 'Лид без следов',
        },
        select: { id: true },
      })
    ).id;
    // КП держит лид внешним ключом `Document_leadId_fkey` (`RESTRICT`).
    await prisma.document.create({
      data: {
        name: 'Коммерческое предложение.pdf',
        path: bx('kp'),
        mimeType: 'application/pdf',
        companyId: ids.company,
        type: 'commercial_proposal',
        leadId: withProposal,
      },
    });
    await journal({ batchId, entity: 'lead', entityId: withProposal, action: 'created' });
    await journal({ batchId, entity: 'lead', entityId: clean, action: 'created' });

    const summary = await runRollback(prisma, batchId);

    expect(await prisma.lead.findUnique({ where: { id: clean } })).toBeNull();
    expect(await prisma.lead.findUnique({ where: { id: withProposal } })).not.toBeNull();
    expect(summary.conflicts.map((c) => c.entityId)).toEqual([withProposal]);
    expect(summary.errors).toEqual([]);
  });

  it('организация с платежом без заказа попадает в конфликты, а не в ошибку', async () => {
    const batchId = await createBatch();
    const paid = await newOrg('Организация с платежом');
    const clean = await newOrg('Организация без платежей');
    // Платёж заведён без заказа и держит организацию `Payment_organizationId_fkey`.
    await prisma.payment.create({
      data: { organizationId: paid, amount: '7500.00', paidAt: new Date() },
    });
    await journal({ batchId, entity: 'organization', entityId: paid, action: 'created' });
    await journal({ batchId, entity: 'organization', entityId: clean, action: 'created' });

    const summary = await runRollback(prisma, batchId);

    expect(await prisma.organization.findUnique({ where: { id: clean } })).toBeNull();
    expect(await prisma.organization.findUnique({ where: { id: paid } })).not.toBeNull();
    expect(summary.conflicts.map((c) => c.entityId)).toEqual([paid]);
    expect(summary.errors).toEqual([]);
  });
});
