import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import { managerOrderScope } from '@/lib/auth/managerPolicy';
import {
  CONTACT_TAB_PAGE,
  getContact,
  isContactTabKey,
  listContactTab,
} from '@/lib/services/contacts/get';

/**
 * Карточка контакта и её вкладки (этап 1 ТЗ 12.09.2026, спека
 * docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.3 и §3.8):
 * чужой и несуществующий контакт неразличимы снаружи (`not_found`), канал
 * пользователя кабинета помечен `locked`, мессенджеры собраны без дублей,
 * сделки считаются отдельным запросом; каждая из шести вкладок — 20 строк со
 * сдвигом и полный `total`, заказы — в скоупе заказов сотрудника. Открытие
 * карточки — чтение ПДн (`contact_card`, §3.10).
 */
const contactFindUnique = vi.fn();
const dealCount = vi.fn();
const dealFindMany = vi.fn();
const dialogFindMany = vi.fn();
const dialogCount = vi.fn();
const callFindMany = vi.fn();
const callCount = vi.fn();
const inboundFindMany = vi.fn();
const inboundCount = vi.fn();
const orderFindMany = vi.fn();
const orderCount = vi.fn();
const auditFindMany = vi.fn();
const auditCount = vi.fn();
const prisma = {
  contact: { findUnique: contactFindUnique },
  deal: { count: dealCount, findMany: dealFindMany },
  messengerDialog: { findMany: dialogFindMany, count: dialogCount },
  call: { findMany: callFindMany, count: callCount },
  inboundMessage: { findMany: inboundFindMany, count: inboundCount },
  order: { findMany: orderFindMany, count: orderCount },
  auditLog: { findMany: auditFindMany, count: auditCount },
} as unknown as PrismaClient;

const admin = { sub: 'a1', role: 'admin', companyId: 'c1' } as SessionPayload;
const manager = {
  sub: 'm1',
  role: 'manager',
  companyId: 'c1',
  managedOrgIds: ['o1'],
} as SessionPayload;
const partner = { sub: 'p1', role: 'partner', companyId: 'c1' } as SessionPayload;

const t = (n: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, n));

const user = {
  id: 'u1',
  name: 'Иван П.',
  email: 'ivan@test.ru',
  telegramChatId: 'tg-1',
  maxChatId: null,
  whatsappPhone: '+79211234567',
};

const card = {
  id: 'k1',
  companyId: 'c1',
  organizationId: 'o1',
  name: 'Иван',
  position: 'Директор',
  note: 'важный',
  isArchived: false,
  mergedIntoId: null,
  createdAt: t(1),
  updatedAt: t(2),
  organization: { id: 'o1', name: 'Ромашка' },
  user,
  channels: [
    {
      id: 'ch1',
      type: 'phone',
      value: '8 921 123-45-67',
      normalizedValue: '+79211234567',
      isPrimary: true,
    },
    { id: 'ch2', type: 'telegram', value: 'tg-1', normalizedValue: 'tg-1', isPrimary: false },
    {
      id: 'ch3',
      type: 'email',
      value: 'other@test.ru',
      normalizedValue: 'other@test.ru',
      isPrimary: false,
    },
    { id: 'ch4', type: 'telegram', value: 'tg-9', normalizedValue: 'tg-9', isPrimary: false },
    { id: 'ch5', type: 'max', value: 'max-1', normalizedValue: 'max-1', isPrimary: false },
  ],
  _count: { messengerDialogs: 2, calls: 3, inboundMessages: 4, ordersAsPrimary: 5 },
};

describe('getContact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dealCount.mockResolvedValue(6);
  });

  it('клиентская роль → forbidden без запроса', async () => {
    await expect(getContact(prisma, partner, true, 'k1')).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(contactFindUnique).not.toHaveBeenCalled();
  });

  it('нет контакта / чужая компания / вне охвата менеджера → not_found, сделки и ПДн не трогаем', async () => {
    contactFindUnique.mockResolvedValueOnce(null);
    await expect(getContact(prisma, admin, true, 'x')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    contactFindUnique.mockResolvedValueOnce({ ...card, companyId: 'other' });
    await expect(getContact(prisma, admin, true, 'k1')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    // Организация o2 не закреплена за менеджером, команда выключена.
    contactFindUnique.mockResolvedValueOnce({ ...card, organizationId: 'o2' });
    await expect(getContact(prisma, manager, false, 'k1')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(dealCount).not.toHaveBeenCalled();
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  it('собирает карточку: locked у каналов пользователя, мессенджеры без дублей, счётчики, ПДн', async () => {
    contactFindUnique.mockResolvedValueOnce(card);
    const r = await getContact(prisma, manager, true, 'k1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(contactFindUnique).toHaveBeenCalledWith({
      where: { id: 'k1' },
      select: expect.objectContaining({
        companyId: true,
        organizationId: true,
        _count: expect.anything(),
      }),
    });
    expect(dealCount).toHaveBeenCalledWith({ where: { contactId: 'k1', companyId: 'c1' } });
    expect(r.contact).toMatchObject({
      id: 'k1',
      name: 'Иван',
      position: 'Директор',
      note: 'важный',
      isArchived: false,
      mergedIntoId: null,
      createdAt: t(1),
      updatedAt: t(2),
      organization: { id: 'o1', name: 'Ромашка' },
      user: { id: 'u1', name: 'Иван П.', email: 'ivan@test.ru' },
      messengerChannels: ['telegram', 'max'],
      counts: { dialogs: 2, calls: 3, inbound: 4, deals: 6, orders: 5 },
    });
    // В карточку не утекают поля пользователя, нужные только для locked.
    expect(r.contact.user).not.toHaveProperty('telegramChatId');
    expect(r.contact.channels).toEqual([
      { id: 'ch1', type: 'phone', value: '8 921 123-45-67', isPrimary: true, locked: true },
      { id: 'ch2', type: 'telegram', value: 'tg-1', isPrimary: false, locked: true },
      { id: 'ch3', type: 'email', value: 'other@test.ru', isPrimary: false, locked: false },
      { id: 'ch4', type: 'telegram', value: 'tg-9', isPrimary: false, locked: false },
      { id: 'ch5', type: 'max', value: 'max-1', isPrimary: false, locked: false },
    ]);
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, {
      session: manager,
      context: 'contact_card',
      subjectIds: ['k1'],
    });
  });

  it('контакт без пользователя и организации: user null, ни один канал не заблокирован', async () => {
    contactFindUnique.mockResolvedValueOnce({
      ...card,
      organizationId: null,
      organization: null,
      user: null,
      channels: card.channels.slice(0, 2),
    });
    const r = await getContact(prisma, admin, true, 'k1');
    if (!r.ok) throw new Error('unexpected');
    expect(r.contact.user).toBeNull();
    expect(r.contact.organization).toBeNull();
    expect(r.contact.channels.map((c) => c.locked)).toEqual([false, false]);
    expect(r.contact.messengerChannels).toEqual(['telegram']);
  });
});

describe('isContactTabKey', () => {
  it('знает шесть вкладок; «Задачи» появятся в этапе 4', () => {
    for (const key of ['dialogs', 'calls', 'inbound', 'deals', 'orders', 'history']) {
      expect(isContactTabKey(key)).toBe(true);
    }
    expect(isContactTabKey('tasks')).toBe(false);
  });
});

describe('listContactTab', () => {
  const scopeRow = { id: 'k1', companyId: 'c1', organizationId: 'o1' };

  beforeEach(() => {
    vi.clearAllMocks();
    contactFindUnique.mockResolvedValue(scopeRow);
    for (const c of [dialogCount, callCount, inboundCount, dealCount, orderCount, auditCount]) {
      c.mockResolvedValue(42);
    }
  });

  it('клиентская роль → forbidden; нет контакта или чужая компания → not_found', async () => {
    await expect(
      listContactTab(prisma, partner, true, { contactId: 'k1', tab: 'dialogs' })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    expect(contactFindUnique).not.toHaveBeenCalled();

    contactFindUnique.mockResolvedValueOnce(null);
    await expect(
      listContactTab(prisma, admin, true, { contactId: 'x', tab: 'dialogs' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    contactFindUnique.mockResolvedValueOnce({ ...scopeRow, companyId: 'other' });
    await expect(
      listContactTab(prisma, admin, true, { contactId: 'k1', tab: 'dialogs' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    expect(contactFindUnique).toHaveBeenCalledWith({
      where: { id: 'x' },
      select: { id: true, companyId: true, organizationId: true },
    });
    expect(dialogFindMany).not.toHaveBeenCalled();
  });

  it('диалоги: подпись мессенджера, превью в одну строку с обрезкой, сдвиг по умолчанию 0', async () => {
    const long = `первая   строка\n\nвторая ${'х'.repeat(200)}`;
    dialogFindMany.mockResolvedValueOnce([
      {
        id: 'd1',
        channel: 'telegram',
        lastMessageAt: t(5),
        lastMessagePreview: long,
        status: 'open',
      },
      {
        id: 'd2',
        channel: 'email',
        lastMessageAt: t(4),
        lastMessagePreview: null,
        status: 'closed',
      },
    ]);
    const r = await listContactTab(prisma, admin, true, { contactId: 'k1', tab: 'dialogs' });
    if (!r.ok) throw new Error('unexpected');
    expect(r.total).toBe(42);
    expect(r.items[0]).toMatchObject({
      kind: 'dialogs',
      id: 'd1',
      at: t(5),
      title: 'Диалог в Telegram',
      status: 'open',
    });
    expect(r.items[0]?.subtitle).toHaveLength(140);
    expect(r.items[0]?.subtitle?.startsWith('первая строка вторая ')).toBe(true);
    expect(r.items[0]?.subtitle?.endsWith('…')).toBe(true);
    expect(r.items[1]).toEqual({
      kind: 'dialogs',
      id: 'd2',
      at: t(4),
      title: 'Диалог в email',
      subtitle: null,
      status: 'closed',
    });
    expect(dialogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contactId: 'k1' }, skip: 0, take: CONTACT_TAB_PAGE })
    );
    expect(dialogCount).toHaveBeenCalledWith({ where: { contactId: 'k1' } });
  });

  it('звонки: направление, длительность, время начала или создания; отрицательный сдвиг → 0', async () => {
    callFindMany.mockResolvedValueOnce([
      {
        id: 'c1',
        direction: 'out',
        callerNumber: '+79211234567',
        startedAt: t(3),
        createdAt: t(2),
        durationSec: 30,
        status: 'answered',
      },
      {
        id: 'c2',
        direction: 'in',
        callerNumber: '+79210000000',
        startedAt: null,
        createdAt: t(1),
        durationSec: null,
        status: 'missed',
      },
    ]);
    const r = await listContactTab(prisma, admin, true, {
      contactId: 'k1',
      tab: 'calls',
      skip: -5,
    });
    if (!r.ok) throw new Error('unexpected');
    expect(r.items).toEqual([
      {
        kind: 'calls',
        id: 'c1',
        at: t(3),
        title: 'Исходящий звонок',
        subtitle: '+79211234567 · 30 с',
        status: 'answered',
      },
      {
        kind: 'calls',
        id: 'c2',
        at: t(1),
        title: 'Входящий звонок',
        subtitle: '+79210000000',
        status: 'missed',
      },
    ]);
    expect(callFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contactId: 'k1' }, skip: 0, take: CONTACT_TAB_PAGE })
    );
    expect(callCount).toHaveBeenCalledWith({ where: { contactId: 'k1' } });
  });

  it('входящие: тема или начало письма, подпись канала; дробный сдвиг округляется вниз', async () => {
    inboundFindMany.mockResolvedValueOnce([
      {
        id: 'i1',
        channel: 'email',
        subject: ' Тема ',
        body: 'тело',
        createdAt: t(3),
        status: 'bound',
      },
      {
        id: 'i2',
        channel: 'whatsapp',
        subject: '   ',
        body: ' первые  слова ',
        createdAt: t(2),
        status: 'unresolved',
      },
      {
        id: 'i3',
        channel: 'cabinet',
        subject: null,
        body: 'без темы',
        createdAt: t(1),
        status: 'bound',
      },
    ]);
    const r = await listContactTab(prisma, manager, true, {
      contactId: 'k1',
      tab: 'inbound',
      skip: 2.5,
    });
    if (!r.ok) throw new Error('unexpected');
    expect(r.items).toEqual([
      { kind: 'inbound', id: 'i1', at: t(3), title: 'Тема', subtitle: 'email', status: 'bound' },
      {
        kind: 'inbound',
        id: 'i2',
        at: t(2),
        title: 'первые слова',
        subtitle: 'WhatsApp',
        status: 'unresolved',
      },
      {
        kind: 'inbound',
        id: 'i3',
        at: t(1),
        title: 'без темы',
        subtitle: 'cabinet',
        status: 'bound',
      },
    ]);
    expect(inboundFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contactId: 'k1' }, skip: 2, take: CONTACT_TAB_PAGE })
    );
  });

  it('сделки: сумма с копейками или без подписи; фильтр — контакт и компания контакта', async () => {
    dealFindMany.mockResolvedValueOnce([
      { id: 's1', title: 'Обучение', amount: 1500.5, status: 'open', createdAt: t(2) },
      { id: 's2', title: 'Аудит', amount: null, status: 'won', createdAt: t(1) },
    ]);
    const r = await listContactTab(prisma, admin, true, { contactId: 'k1', tab: 'deals' });
    if (!r.ok) throw new Error('unexpected');
    expect(r.items).toEqual([
      {
        kind: 'deals',
        id: 's1',
        at: t(2),
        title: 'Обучение',
        subtitle: '1500.50 ₽',
        status: 'open',
      },
      { kind: 'deals', id: 's2', at: t(1), title: 'Аудит', subtitle: null, status: 'won' },
    ]);
    const where = { contactId: 'k1', companyId: 'c1' };
    expect(dealFindMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(dealCount).toHaveBeenCalledWith({ where });
  });

  it('заказы: админ — пол компании, менеджер — скоуп заказов сотрудника; номер заказа в заголовке', async () => {
    orderFindMany.mockResolvedValue([
      {
        id: 'z1',
        title: 'Курс',
        orderNumber: 'N-1',
        totalAmount: 100,
        createdAt: t(2),
        executionStatus: 'in_progress',
      },
      {
        id: 'z2',
        title: 'Без номера',
        orderNumber: null,
        totalAmount: 0,
        createdAt: t(1),
        executionStatus: 'pending',
      },
    ]);
    const r = await listContactTab(prisma, admin, true, { contactId: 'k1', tab: 'orders' });
    if (!r.ok) throw new Error('unexpected');
    expect(r.items).toEqual([
      {
        kind: 'orders',
        id: 'z1',
        at: t(2),
        title: 'N-1 · Курс',
        subtitle: '100.00 ₽',
        status: 'in_progress',
      },
      {
        kind: 'orders',
        id: 'z2',
        at: t(1),
        title: 'Без номера',
        subtitle: '0.00 ₽',
        status: 'pending',
      },
    ]);
    const adminWhere = { AND: [{ companyId: 'c1' }, { primaryContactId: 'k1' }] };
    expect(orderFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: adminWhere }));
    expect(orderCount).toHaveBeenCalledWith({ where: adminWhere });

    await listContactTab(prisma, manager, false, { contactId: 'k1', tab: 'orders' });
    const managerWhere = { AND: [managerOrderScope(manager, false), { primaryContactId: 'k1' }] };
    expect(orderFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: managerWhere })
    );
    expect(orderCount).toHaveBeenLastCalledWith({ where: managerWhere });
  });

  it('история: русское название действия, автор по имени или пусто', async () => {
    auditFindMany.mockResolvedValueOnce([
      { id: 'a1', action: 'contact_updated', createdAt: t(3), user: { name: 'Мария' } },
      { id: 'a2', action: 'contact_created', createdAt: t(2), user: { name: null } },
      { id: 'a3', action: 'contact_archived', createdAt: t(1), user: null },
    ]);
    const r = await listContactTab(prisma, admin, true, { contactId: 'k1', tab: 'history' });
    if (!r.ok) throw new Error('unexpected');
    expect(r.items).toEqual([
      {
        kind: 'history',
        id: 'a1',
        at: t(3),
        title: 'Изменение контакта',
        subtitle: 'Мария',
        status: null,
      },
      {
        kind: 'history',
        id: 'a2',
        at: t(2),
        title: 'Создание контакта',
        subtitle: null,
        status: null,
      },
      {
        kind: 'history',
        id: 'a3',
        at: t(1),
        title: 'Контакт отправлен в архив',
        subtitle: null,
        status: null,
      },
    ]);
    const where = { entity: 'contact', entityId: 'k1' };
    expect(auditFindMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(auditCount).toHaveBeenCalledWith({ where });
  });
});
