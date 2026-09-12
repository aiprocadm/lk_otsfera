import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { listMergeCandidates, mergeContacts } from '@/lib/services/contacts/merge';
import { contactScopeWhere } from '@/lib/services/contacts/scope';

/**
 * Объединение дублей (этап 1 ТЗ 12.09.2026, спека
 * docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.5):
 * отказы (сам с собой, два пользователя кабинета, главный уже объединён, кто-то
 * вне скоупа), одна транзакция на все связи, `userId` и пустые
 * `position`/`note`/организация главного заполняются из второго — непустые не
 * затираются; аудит `contact_merged` со снимком второго. Кандидаты — контакты
 * скоупа без архивных и самого себя, не больше 20.
 */
const contactFindMany = vi.fn();
const contactUpdate = vi.fn();
const dealCount = vi.fn();
const dealUpdateMany = vi.fn();
const chUpdateMany = vi.fn();
const inboundUpdateMany = vi.fn();
const callUpdateMany = vi.fn();
const dialogUpdateMany = vi.fn();
const orderUpdateMany = vi.fn();
const transaction = vi.fn();
const prisma = {
  contact: { findMany: contactFindMany, update: contactUpdate },
  deal: { count: dealCount, updateMany: dealUpdateMany },
  contactChannel: { updateMany: chUpdateMany },
  inboundMessage: { updateMany: inboundUpdateMany },
  call: { updateMany: callUpdateMany },
  messengerDialog: { updateMany: dialogUpdateMany },
  order: { updateMany: orderUpdateMany },
  $transaction: transaction,
} as unknown as PrismaClient;

const admin = { sub: 'a1', role: 'admin', companyId: 'c1' } as SessionPayload;
const manager = {
  sub: 'm1',
  role: 'manager',
  companyId: 'c1',
  managedOrgIds: ['o1'],
} as SessionPayload;
const partner = { sub: 'p1', role: 'partner', companyId: 'c1' } as SessionPayload;

type Row = {
  id: string;
  companyId: string;
  organizationId: string | null;
  userId: string | null;
  isArchived: boolean;
  mergedIntoId: string | null;
  name: string;
  position: string | null;
  note: string | null;
  _count: Record<string, number>;
};

function row(over: Partial<Row> & { id: string }): Row {
  return {
    companyId: 'c1',
    organizationId: 'o1',
    userId: null,
    isArchived: false,
    mergedIntoId: null,
    name: 'Контакт',
    position: null,
    note: null,
    _count: { channels: 2, inboundMessages: 1, calls: 3, messengerDialogs: 1, ordersAsPrimary: 4 },
    ...over,
  };
}

const args = { primaryId: 'k1', secondaryId: 'k2' };

describe('mergeContacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transaction.mockImplementation((fn: (tx: PrismaClient) => Promise<unknown>) => fn(prisma));
    dealCount.mockResolvedValue(5);
    chUpdateMany.mockResolvedValue({ count: 2 });
    inboundUpdateMany.mockResolvedValue({ count: 1 });
    callUpdateMany.mockResolvedValue({ count: 3 });
    dialogUpdateMany.mockResolvedValue({ count: 1 });
    orderUpdateMany.mockResolvedValue({ count: 4 });
    dealUpdateMany.mockResolvedValue({ count: 5 });
  });

  it('клиентская роль → forbidden; сам с собой → contact_merge_self — оба без запроса', async () => {
    await expect(mergeContacts(prisma, partner, true, args)).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    await expect(
      mergeContacts(prisma, admin, true, { primaryId: 'k1', secondaryId: 'k1' })
    ).resolves.toEqual({ ok: false, error: 'contact_merge_self' });
    expect(contactFindMany).not.toHaveBeenCalled();
  });

  it('нет главного / нет второго / любой вне скоупа → not_found без транзакции', async () => {
    contactFindMany.mockResolvedValueOnce([row({ id: 'k2' })]);
    await expect(mergeContacts(prisma, admin, true, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(contactFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['k1', 'k2'] } },
      select: expect.objectContaining({
        userId: true,
        mergedIntoId: true,
        _count: expect.anything(),
      }),
    });
    contactFindMany.mockResolvedValueOnce([row({ id: 'k1' })]);
    await expect(mergeContacts(prisma, admin, true, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    contactFindMany.mockResolvedValueOnce([
      row({ id: 'k1', companyId: 'other' }),
      row({ id: 'k2' }),
    ]);
    await expect(mergeContacts(prisma, admin, true, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    contactFindMany.mockResolvedValueOnce([
      row({ id: 'k1' }),
      row({ id: 'k2', companyId: 'other' }),
    ]);
    await expect(mergeContacts(prisma, admin, true, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    // Второй — в незакреплённой организации, команда выключена: менеджеру не виден.
    contactFindMany.mockResolvedValueOnce([
      row({ id: 'k1' }),
      row({ id: 'k2', organizationId: 'o2' }),
    ]);
    await expect(mergeContacts(prisma, manager, false, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(dealCount).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('главный уже объединён → contact_merge_target_merged; два пользователя кабинета → contact_merge_two_users', async () => {
    contactFindMany.mockResolvedValueOnce([
      row({ id: 'k1', mergedIntoId: 'k0' }),
      row({ id: 'k2' }),
    ]);
    await expect(mergeContacts(prisma, admin, true, args)).resolves.toEqual({
      ok: false,
      error: 'contact_merge_target_merged',
    });
    contactFindMany.mockResolvedValueOnce([
      row({ id: 'k1', userId: 'u1' }),
      row({ id: 'k2', userId: 'u2' }),
    ]);
    await expect(mergeContacts(prisma, admin, true, args)).resolves.toEqual({
      ok: false,
      error: 'contact_merge_two_users',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('переезд связей одной транзакцией: пользователь второго — главному, непустые поля главного не затираются', async () => {
    contactFindMany.mockResolvedValueOnce([
      row({ id: 'k1', name: 'Иван', position: 'Директор', note: 'важно', organizationId: 'o1' }),
      row({
        id: 'k2',
        name: 'Иван П.',
        userId: 'u2',
        position: 'Зам',
        note: 'дубль',
        organizationId: 'o2',
      }),
    ]);
    await expect(mergeContacts(prisma, manager, true, args)).resolves.toEqual({
      ok: true,
      primaryId: 'k1',
      moved: {
        channels: 2,
        inbound: 1,
        calls: 3,
        dialogs: 1,
        orders: 4,
        deals: 5,
        userMoved: true,
      },
    });
    expect(dealCount).toHaveBeenCalledWith({ where: { contactId: 'k2' } });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function));
    expect(chUpdateMany).toHaveBeenCalledWith({
      where: { contactId: 'k2' },
      data: { contactId: 'k1', isPrimary: false },
    });
    for (const m of [inboundUpdateMany, callUpdateMany, dialogUpdateMany, dealUpdateMany]) {
      expect(m).toHaveBeenCalledWith({ where: { contactId: 'k2' }, data: { contactId: 'k1' } });
    }
    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: { primaryContactId: 'k2' },
      data: { primaryContactId: 'k1' },
    });
    // Сначала снимаем userId у второго (уникальность), потом отдаём главному.
    expect(contactUpdate.mock.calls).toEqual([
      [{ where: { id: 'k2' }, data: { userId: null, isArchived: true, mergedIntoId: 'k1' } }],
      [{ where: { id: 'k1' }, data: { userId: 'u2' } }],
    ]);
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'contact_merged',
      entity: 'contact',
      entityId: 'k1',
      userId: 'm1',
      before: {
        name: 'Иван П.',
        organizationId: 'o2',
        channels: 2,
        inbound: 1,
        calls: 3,
        dialogs: 1,
        orders: 4,
        deals: 5,
      },
      after: { mergedFromId: 'k2' },
    });
  });

  it('пустые должность, заметка и организация главного заполняются из второго; свой пользователь остаётся', async () => {
    contactFindMany.mockResolvedValueOnce([
      row({ id: 'k1', userId: 'u1', position: null, note: null, organizationId: null }),
      row({ id: 'k2', position: 'Зам', note: 'дубль', organizationId: 'o2' }),
    ]);
    const r = await mergeContacts(prisma, admin, true, args);
    expect(r).toMatchObject({ ok: true, moved: { userMoved: false } });
    expect(contactUpdate).toHaveBeenLastCalledWith({
      where: { id: 'k1' },
      data: { position: 'Зам', note: 'дубль', organizationId: 'o2' },
    });
  });
});

describe('listMergeCandidates', () => {
  const items = [{ id: 'k2', name: 'Пётр', position: null, organization: null, channels: [] }];

  beforeEach(() => {
    vi.clearAllMocks();
    contactFindMany.mockResolvedValue(items);
  });

  it('клиентская роль → forbidden без запроса', async () => {
    await expect(listMergeCandidates(prisma, partner, true, { excludeId: 'k1' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(contactFindMany).not.toHaveBeenCalled();
  });

  it('без поиска: скоуп, без архивных и самого себя, не больше 20, по имени', async () => {
    await expect(listMergeCandidates(prisma, manager, false, { excludeId: 'k1' })).resolves.toEqual(
      {
        ok: true,
        items,
      }
    );
    expect(contactFindMany).toHaveBeenCalledWith({
      where: {
        AND: [contactScopeWhere(manager, false), { isArchived: false, id: { not: 'k1' } }],
      },
      select: {
        id: true,
        name: true,
        position: true,
        organization: { select: { id: true, name: true } },
        channels: { select: { type: true, value: true }, orderBy: { isPrimary: 'desc' } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 20,
    });
  });

  it('поиск по имени добавляет условие; строка из пробелов — нет', async () => {
    await listMergeCandidates(prisma, admin, true, { excludeId: 'k1', q: ' Ив ' });
    expect(contactFindMany.mock.calls[0][0].where.AND).toEqual([
      { companyId: 'c1' },
      { isArchived: false, id: { not: 'k1' } },
      { name: { contains: 'Ив', mode: 'insensitive' } },
    ]);
    await listMergeCandidates(prisma, admin, true, { excludeId: 'k1', q: '   ' });
    expect(contactFindMany.mock.calls[1][0].where.AND).toHaveLength(2);
  });
});
