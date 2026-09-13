import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit, recordPiiAccess } = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  recordPiiAccess: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import { getOrderContactPanel, setOrderPrimaryContact } from '@/lib/services/orders/primaryContact';
import { contactScopeWhere } from '@/lib/services/contacts/scope';

/**
 * «Контакт заказа» (этап 1 ТЗ 12.09.2026, `У-180`, спека 04 §«карточка заказа»):
 * панель показывает текущего человека и варианты из организации заказа;
 * назначение проверяет скоуп заказа (как карточка: `canSeeOrder` с `teamMode`,
 * руководитель — вся компания, администратор — компания), контакт — не в
 * архиве, в охвате сотрудника и именно из организации заказа. Скоуп-хелперы
 * и `listContactOptions` — настоящие; моки — только журнал аудита и ПДн.
 */

type Mocks = {
  orderFindUnique: ReturnType<typeof vi.fn>;
  orderUpdate: ReturnType<typeof vi.fn>;
  contactFindMany: ReturnType<typeof vi.fn>;
  contactFindFirst: ReturnType<typeof vi.fn>;
  contactFindUnique: ReturnType<typeof vi.fn>;
};

function makePrisma(
  opts: { order?: unknown; options?: unknown[]; current?: unknown; contact?: unknown } = {}
): { prisma: PrismaClient } & Mocks {
  const orderFindUnique = vi.fn().mockResolvedValue(opts.order ?? null);
  const orderUpdate = vi.fn().mockResolvedValue({});
  const contactFindMany = vi.fn().mockResolvedValue(opts.options ?? []);
  const contactFindFirst = vi.fn().mockResolvedValue(opts.current ?? null);
  const contactFindUnique = vi.fn().mockResolvedValue(opts.contact ?? null);
  const prisma = {
    order: { findUnique: orderFindUnique, update: orderUpdate },
    contact: {
      findMany: contactFindMany,
      findFirst: contactFindFirst,
      findUnique: contactFindUnique,
    },
  } as unknown as PrismaClient;
  return {
    prisma,
    orderFindUnique,
    orderUpdate,
    contactFindMany,
    contactFindFirst,
    contactFindUnique,
  };
}

const ADMIN = { sub: 'a1', role: 'admin', companyId: 'c1' } as SessionPayload;
const ADMIN_C2 = { sub: 'a2', role: 'admin', companyId: 'c2' } as SessionPayload;
const LEADER = { sub: 'l1', role: 'leader', companyId: 'c1' } as SessionPayload;
const MANAGER = {
  sub: 'm1',
  role: 'manager',
  companyId: 'c1',
  managedOrgIds: ['o1'],
} as SessionPayload;
const PARTNER = { sub: 'p1', role: 'partner', companyId: 'c1' } as SessionPayload;

const OPTION = { id: 'k1', name: 'Иванов', position: 'директор', organizationId: 'o1' };
const ORDER_SHAPE = { organizationId: 'o1', companyId: 'c1', primaryContactId: null };

/** Заказ для `setOrderPrimaryContact`: свой менеджер m1, организация o1. */
function order(over: Record<string, unknown> = {}) {
  return {
    id: 'ord-1',
    managerId: 'm1',
    organizationId: 'o1',
    companyId: 'c1',
    primaryContactId: null,
    ...over,
  };
}

/** Живой контакт компании c1 в организации o1 — годится к заказу выше. */
function contact(over: Record<string, unknown> = {}) {
  return { id: 'k1', companyId: 'c1', organizationId: 'o1', isArchived: false, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── getOrderContactPanel ─────────────────────────────────────────────────────

describe('getOrderContactPanel — когда панели нет', () => {
  it('без права на справочник → null без запросов', async () => {
    const { prisma, contactFindMany, contactFindFirst } = makePrisma();
    expect(await getOrderContactPanel(prisma, PARTNER, true, ORDER_SHAPE)).toBeNull();
    expect(contactFindMany).not.toHaveBeenCalled();
    expect(contactFindFirst).not.toHaveBeenCalled();
  });

  it('заказ чужой компании → null даже администратору (контакты живут в границах компании)', async () => {
    const { prisma, contactFindMany } = makePrisma();
    expect(await getOrderContactPanel(prisma, ADMIN_C2, true, ORDER_SHAPE)).toBeNull();
    expect(contactFindMany).not.toHaveBeenCalled();
  });
});

describe('getOrderContactPanel — варианты и текущий', () => {
  it('заказ без организации → варианты пустые без запроса, текущего нет', async () => {
    const { prisma, contactFindMany, contactFindFirst } = makePrisma();
    expect(
      await getOrderContactPanel(prisma, ADMIN, true, { ...ORDER_SHAPE, organizationId: null })
    ).toEqual({ current: null, options: [] });
    expect(contactFindMany).not.toHaveBeenCalled();
    expect(contactFindFirst).not.toHaveBeenCalled();
  });

  it('варианты — контакты организации заказа в охвате сотрудника; контакт не выбран → current null', async () => {
    const { prisma, contactFindMany, contactFindFirst } = makePrisma({ options: [OPTION] });
    expect(await getOrderContactPanel(prisma, MANAGER, false, ORDER_SHAPE)).toEqual({
      current: null,
      options: [OPTION],
    });
    const where = (contactFindMany.mock.calls[0]![0] as { where: { AND: unknown[] } }).where;
    expect(where.AND).toEqual([
      contactScopeWhere(MANAGER, false),
      { isArchived: false },
      { organizationId: 'o1' },
    ]);
    expect(contactFindFirst).not.toHaveBeenCalled();
    // Одно событие ПДн — от списка вариантов.
    expect(recordPiiAccess).toHaveBeenCalledTimes(1);
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, {
      session: MANAGER,
      context: 'contacts_options',
      subjectIds: ['k1'],
    });
  });

  it('выбранный контакт есть среди вариантов → берётся оттуда, отдельного чтения нет', async () => {
    const { prisma, contactFindFirst } = makePrisma({ options: [OPTION] });
    expect(
      await getOrderContactPanel(prisma, ADMIN, true, { ...ORDER_SHAPE, primaryContactId: 'k1' })
    ).toEqual({ current: { ...OPTION, isArchived: false }, options: [OPTION] });
    expect(contactFindFirst).not.toHaveBeenCalled();
  });

  it('выбранный контакт вне вариантов (архив/другая организация) → читается отдельно в границах компании + событие ПДн', async () => {
    const archived = { ...OPTION, id: 'k9', name: 'Сидоров', isArchived: true };
    const { prisma, contactFindFirst } = makePrisma({ options: [OPTION], current: archived });
    expect(
      await getOrderContactPanel(prisma, LEADER, false, { ...ORDER_SHAPE, primaryContactId: 'k9' })
    ).toEqual({ current: archived, options: [OPTION] });
    expect(contactFindFirst).toHaveBeenCalledWith({
      where: { id: 'k9', companyId: 'c1' },
      select: { id: true, name: true, position: true, organizationId: true, isArchived: true },
    });
    expect(recordPiiAccess).toHaveBeenCalledTimes(2);
    expect(recordPiiAccess).toHaveBeenLastCalledWith(prisma, {
      session: LEADER,
      context: 'contacts_options',
      subjectIds: ['k9'],
    });
  });

  it('выбранный контакт не найден в компании → current null, события ПДн нет', async () => {
    const { prisma, contactFindFirst } = makePrisma({ options: [], current: null });
    expect(
      await getOrderContactPanel(prisma, ADMIN, true, {
        ...ORDER_SHAPE,
        primaryContactId: 'k-ghost',
      })
    ).toEqual({ current: null, options: [] });
    expect(contactFindFirst).toHaveBeenCalledTimes(1);
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });
});

// ─── setOrderPrimaryContact — скоуп заказа ────────────────────────────────────

describe('setOrderPrimaryContact — скоуп заказа', () => {
  it('без права на справочник → forbidden без запросов', async () => {
    const { prisma, orderFindUnique } = makePrisma();
    expect(
      await setOrderPrimaryContact(prisma, PARTNER, true, { orderId: 'ord-1', contactId: 'k1' })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(orderFindUnique).not.toHaveBeenCalled();
  });

  it('заказа нет → not_found; читаются только поля скоупа', async () => {
    const { prisma, orderFindUnique } = makePrisma({ order: null });
    expect(
      await setOrderPrimaryContact(prisma, ADMIN, true, { orderId: 'ord-x', contactId: null })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(orderFindUnique).toHaveBeenCalledWith({
      where: { id: 'ord-x' },
      select: {
        id: true,
        managerId: true,
        organizationId: true,
        companyId: true,
        primaryContactId: true,
      },
    });
  });

  it('заказ чужой компании → forbidden даже администратору', async () => {
    const { prisma, orderUpdate } = makePrisma({ order: order({ companyId: 'c2' }) });
    expect(
      await setOrderPrimaryContact(prisma, ADMIN, true, { orderId: 'ord-1', contactId: null })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('менеджер без команды: чужой заказ незакреплённой организации → not_found', async () => {
    const { prisma, orderUpdate } = makePrisma({
      order: order({ managerId: 'm-other', organizationId: 'o2', primaryContactId: 'k1' }),
    });
    expect(
      await setOrderPrimaryContact(prisma, MANAGER, false, { orderId: 'ord-1', contactId: null })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('менеджер видит заказ: свой / закреплённой организации / любой при команде', async () => {
    for (const [o, teamMode] of [
      [order({ managerId: 'm1', organizationId: 'o2', primaryContactId: 'k1' }), false],
      [order({ managerId: 'm-other', organizationId: 'o1', primaryContactId: 'k1' }), false],
      [order({ managerId: 'm-other', organizationId: 'o2', primaryContactId: 'k1' }), true],
    ] as const) {
      const { prisma, orderUpdate } = makePrisma({ order: o });
      expect(
        await setOrderPrimaryContact(prisma, MANAGER, teamMode, {
          orderId: 'ord-1',
          contactId: null,
        })
      ).toEqual({ ok: true });
      expect(orderUpdate).toHaveBeenCalledTimes(1);
    }
  });

  it('руководитель без команды и администратор видят любой заказ своей компании', async () => {
    const alien = order({ managerId: 'm-other', organizationId: 'o2', primaryContactId: 'k1' });
    for (const s of [LEADER, ADMIN]) {
      const { prisma, orderUpdate } = makePrisma({ order: alien });
      expect(
        await setOrderPrimaryContact(prisma, s, false, { orderId: 'ord-1', contactId: null })
      ).toEqual({ ok: true });
      expect(orderUpdate).toHaveBeenCalledTimes(1);
    }
  });
});

// ─── setOrderPrimaryContact — проверка контакта ───────────────────────────────

describe('setOrderPrimaryContact — проверка контакта', () => {
  it('контакт читается по id с полями скоупа', async () => {
    const { prisma, contactFindUnique } = makePrisma({ order: order(), contact: contact() });
    await setOrderPrimaryContact(prisma, ADMIN, true, { orderId: 'ord-1', contactId: 'k1' });
    expect(contactFindUnique).toHaveBeenCalledWith({
      where: { id: 'k1' },
      select: { id: true, companyId: true, organizationId: true, isArchived: true },
    });
  });

  it.each([
    ['контакта нет', null, order()],
    ['контакт в архиве', contact({ isArchived: true }), order()],
    ['контакт чужой компании', contact({ companyId: 'c2' }), order()],
    ['у заказа нет организации', contact(), order({ organizationId: null })],
    ['контакт из другой организации', contact({ organizationId: 'o2' }), order()],
    ['контакт «с улицы» (без организации)', contact({ organizationId: null }), order()],
  ])('%s → contact_not_found, запись не меняется', async (_name, c, o) => {
    const { prisma, orderUpdate } = makePrisma({ order: o, contact: c });
    expect(
      await setOrderPrimaryContact(prisma, ADMIN, true, { orderId: 'ord-1', contactId: 'k1' })
    ).toEqual({ ok: false, error: 'contact_not_found' });
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('менеджер без команды: контакт незакреплённой организации вне охвата → contact_not_found; с командой — ok', async () => {
    // Заказ свой (managerId = m1), но организация o2 не закреплена: заказ виден,
    // а контакт этой организации — нет.
    const o = order({ organizationId: 'o2' });
    const c = contact({ organizationId: 'o2' });
    const first = makePrisma({ order: o, contact: c });
    expect(
      await setOrderPrimaryContact(first.prisma, MANAGER, false, {
        orderId: 'ord-1',
        contactId: 'k1',
      })
    ).toEqual({ ok: false, error: 'contact_not_found' });
    expect(first.orderUpdate).not.toHaveBeenCalled();

    const second = makePrisma({ order: o, contact: c });
    expect(
      await setOrderPrimaryContact(second.prisma, MANAGER, true, {
        orderId: 'ord-1',
        contactId: 'k1',
      })
    ).toEqual({ ok: true });
    expect(second.orderUpdate).toHaveBeenCalledTimes(1);
  });

  it('снятие контакта (null) не ходит за контактом', async () => {
    const { prisma, contactFindUnique } = makePrisma({ order: order({ primaryContactId: 'k1' }) });
    expect(
      await setOrderPrimaryContact(prisma, ADMIN, true, { orderId: 'ord-1', contactId: null })
    ).toEqual({ ok: true });
    expect(contactFindUnique).not.toHaveBeenCalled();
  });
});

// ─── setOrderPrimaryContact — запись и аудит ──────────────────────────────────

describe('setOrderPrimaryContact — запись и аудит', () => {
  it('повтор того же значения → ok без записи и аудита (и для контакта, и для «не указан»)', async () => {
    const same = makePrisma({ order: order({ primaryContactId: 'k1' }), contact: contact() });
    expect(
      await setOrderPrimaryContact(same.prisma, ADMIN, true, { orderId: 'ord-1', contactId: 'k1' })
    ).toEqual({ ok: true });
    expect(same.orderUpdate).not.toHaveBeenCalled();

    const empty = makePrisma({ order: order({ primaryContactId: null }) });
    expect(
      await setOrderPrimaryContact(empty.prisma, ADMIN, true, { orderId: 'ord-1', contactId: null })
    ).toEqual({ ok: true });
    expect(empty.orderUpdate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('назначение: запись в заказ + аудит order_primary_contact_changed с до/после', async () => {
    const { prisma, orderUpdate } = makePrisma({
      order: order({ primaryContactId: 'k0' }),
      contact: contact(),
    });
    expect(
      await setOrderPrimaryContact(prisma, MANAGER, false, { orderId: 'ord-1', contactId: 'k1' })
    ).toEqual({ ok: true });
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'ord-1' },
      data: { primaryContactId: 'k1' },
    });
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'm1',
      action: 'order_primary_contact_changed',
      entity: 'order',
      entityId: 'ord-1',
      before: { contactId: 'k0' },
      after: { contactId: 'k1' },
    });
  });

  it('снятие: primaryContactId → null + аудит с прежним значением', async () => {
    const { prisma, orderUpdate } = makePrisma({ order: order({ primaryContactId: 'k1' }) });
    expect(
      await setOrderPrimaryContact(prisma, LEADER, false, { orderId: 'ord-1', contactId: null })
    ).toEqual({ ok: true });
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'ord-1' },
      data: { primaryContactId: null },
    });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'l1',
      action: 'order_primary_contact_changed',
      entity: 'order',
      entityId: 'ord-1',
      before: { contactId: 'k1' },
      after: { contactId: null },
    });
  });
});
