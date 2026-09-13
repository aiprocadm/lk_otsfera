import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  channelKey,
  loadCompanyUsers,
  loadContacts,
  loadDeals,
  loadDocuments,
  loadLeads,
  loadOrders,
  loadOrganizations,
  loadTasks,
  organizationKeysOf,
} from '@/lib/services/bitrix/mapping/lookup';

/**
 * Чтение состояния ЛК пачкой на страницу (`У-200`, спека §3.2).
 *
 * Проверяется ровно то, ради чего модуль написан: сколько бы записей ни пришло
 * со страницы источника, база спрашивается фиксированное число раз, запрос
 * собирается только из непустых условий, а пустой список вообще не доходит до
 * базы. Prisma — объект с нужными методами: живой Postgres здесь не нужен и
 * увёл бы файл в integration-слой.
 */
const organizationFindMany = vi.fn();
const contactFindMany = vi.fn();
const contactChannelFindMany = vi.fn();
const userFindMany = vi.fn();
const leadFindMany = vi.fn();
const dealFindMany = vi.fn();
const taskFindMany = vi.fn();
const documentFindMany = vi.fn();
const orderFindMany = vi.fn();

const prisma = {
  organization: { findMany: organizationFindMany },
  contact: { findMany: contactFindMany },
  contactChannel: { findMany: contactChannelFindMany },
  user: { findMany: userFindMany },
  lead: { findMany: leadFindMany },
  deal: { findMany: dealFindMany },
  task: { findMany: taskFindMany },
  document: { findMany: documentFindMany },
  order: { findMany: orderFindMany },
} as unknown as PrismaClient;

const COMPANY = 'c1';

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [
    organizationFindMany,
    contactFindMany,
    contactChannelFindMany,
    userFindMany,
    leadFindMany,
    dealFindMany,
    taskFindMany,
    documentFindMany,
    orderFindMany,
  ]) {
    fn.mockResolvedValue([]);
  }
});

describe('loadOrganizations', () => {
  it('строит три карты и НЕ кладёт чужую компанию в карту по названию', async () => {
    organizationFindMany.mockResolvedValue([
      {
        id: 'o-own',
        companyId: COMPANY,
        name: 'ООО «Альфа»',
        inn: '7701234560',
        kpp: '770101001',
        bitrixId: '101',
        nameKey: 'АЛЬФА',
      },
      {
        // Тёзка из чужой компании: по ИНН видеть обязаны (индекс глобальный),
        // по названию — нет, иначе перенос уедет в чужой контур.
        id: 'o-alien',
        companyId: 'c2',
        name: 'ООО «Бета»',
        inn: '7812345675',
        kpp: null,
        bitrixId: null,
        nameKey: 'БЕТА',
      },
    ]);

    const batch = await loadOrganizations(prisma, COMPANY, {
      bitrixIds: ['101'],
      inns: ['7701234560', '7812345675'],
      nameKeys: ['АЛЬФА', 'БЕТА'],
    });

    expect(batch.byBitrixId.get('101')?.id).toBe('o-own');
    expect(batch.byInn.get('7701234560')?.id).toBe('o-own');
    expect(batch.byInn.get('7812345675')?.id).toBe('o-alien');
    expect(batch.byNameKey.get('АЛЬФА')?.id).toBe('o-own');
    expect(batch.byNameKey.get('БЕТА')).toBeUndefined();
    // Наружу уходит узкая форма, а не строка базы: `nameKey` в ней нет.
    expect(batch.byBitrixId.get('101')).toEqual({
      id: 'o-own',
      companyId: COMPANY,
      name: 'ООО «Альфа»',
      inn: '7701234560',
      kpp: '770101001',
      bitrixId: '101',
    });
  });

  it('строка без bitrixId, без ИНН и без ключа названия не попадает никуда', async () => {
    organizationFindMany.mockResolvedValue([
      {
        id: 'o-bare',
        companyId: COMPANY,
        name: 'ООО',
        inn: null,
        kpp: null,
        bitrixId: null,
        nameKey: null,
      },
    ]);

    const batch = await loadOrganizations(prisma, COMPANY, {
      bitrixIds: [],
      inns: [],
      nameKeys: [],
    });

    expect(batch.byBitrixId.size + batch.byInn.size + batch.byNameKey.size).toBe(0);
  });

  it('одна выборка на страницу, а условия — только непустые', async () => {
    await loadOrganizations(prisma, COMPANY, { bitrixIds: [], inns: [], nameKeys: ['АЛЬФА'] });

    expect(organizationFindMany).toHaveBeenCalledTimes(1);
    expect(organizationFindMany.mock.calls[0][0].where).toEqual({
      OR: [{ companyId: COMPANY, nameKey: { in: ['АЛЬФА'] } }],
    });

    await loadOrganizations(prisma, COMPANY, {
      bitrixIds: ['101'],
      inns: ['7701234560'],
      nameKeys: [],
    });
    expect(organizationFindMany.mock.calls[1][0].where).toEqual({
      OR: [{ bitrixId: { in: ['101'] } }, { inn: { in: ['7701234560'] } }],
    });
  });

  it('ИНН ищется без фильтра по компании — иначе тёзку из чужой компании не увидеть', async () => {
    await loadOrganizations(prisma, COMPANY, { bitrixIds: [], inns: ['7701234560'], nameKeys: [] });

    const inn = organizationFindMany.mock.calls[0][0].where.OR[0];
    expect(inn).toEqual({ inn: { in: ['7701234560'] } });
    expect(Object.keys(inn)).not.toContain('companyId');
  });
});

describe('organizationKeysOf', () => {
  it('считает ключи названий, пустые ключи и пустые ИНН отбрасывает', () => {
    expect(
      organizationKeysOf([
        { id: '101', inn: '7701234560', title: 'ООО «Альфа Строй»' },
        { id: '102', inn: null, title: 'Вектор Плюс, ООО' },
        // Название из одной орг-формы ключа не даёт — такой строки в запросе нет.
        { id: '103', inn: null, title: 'ООО' },
        { id: '104', inn: '', title: '' },
      ])
    ).toEqual({
      bitrixIds: ['101', '102', '103', '104'],
      inns: ['7701234560'],
      nameKeys: ['АЛЬФА СТРОЙ', 'ВЕКТОР ПЛЮС'],
    });
  });
});

describe('channelKey', () => {
  it('ключ канала — тип и нормализованное значение через двоеточие', () => {
    expect(channelKey('email', 'ivanova@alfa.local')).toBe('email:ivanova@alfa.local');
    expect(channelKey('phone', '+79211112233')).toBe('phone:+79211112233');
  });
});

describe('loadContacts', () => {
  const CONTACT = {
    id: 'k1',
    name: 'Анна Иванова',
    position: 'Директор',
    organizationId: 'o1',
    bitrixId: '201',
  };

  it('собирает владельцев каналов, карты по id и bitrixId и каналы сотрудников', async () => {
    contactFindMany.mockResolvedValue([CONTACT]);
    contactChannelFindMany.mockResolvedValue([
      {
        type: 'email',
        normalizedValue: 'orlova@vector.local',
        // Контакт без bitrixId: такой канал означает «это он», а не конфликт.
        contact: {
          id: 'k2',
          name: 'Дарья Орлова',
          position: null,
          organizationId: null,
          bitrixId: null,
        },
      },
    ]);
    userFindMany.mockResolvedValue([
      { email: 'Manager@Demo.Local', whatsappPhone: '+79990001122' },
      { email: null, whatsappPhone: '+79995554433' },
      { email: 'leader@demo.local', whatsappPhone: null },
    ]);

    const batch = await loadContacts(prisma, COMPANY, {
      bitrixIds: ['201'],
      channels: [
        { type: 'email', normalizedValue: 'orlova@vector.local' },
        { type: 'email', normalizedValue: 'manager@demo.local' },
      ],
    });

    expect(batch.byBitrixId.get('201')).toEqual(CONTACT);
    expect(batch.byId.get('k1')).toEqual(CONTACT);
    expect(batch.byId.get('k2')?.name).toBe('Дарья Орлова');
    expect(batch.channelOwners.get('email:orlova@vector.local')).toEqual({
      contactId: 'k2',
      contactName: 'Дарья Орлова',
      bitrixId: null,
    });
    // Почта сотрудника приводится к нижнему регистру, телефон берётся как есть.
    expect([...batch.userChannels].sort()).toEqual([
      'email:leader@demo.local',
      'email:manager@demo.local',
      'phone:+79990001122',
      'phone:+79995554433',
    ]);
  });

  it('контакт без bitrixId живёт только в карте по id', async () => {
    contactFindMany.mockResolvedValue([{ ...CONTACT, bitrixId: null }]);

    const batch = await loadContacts(prisma, COMPANY, {
      bitrixIds: ['201'],
      channels: [],
    });

    expect(batch.byId.has('k1')).toBe(true);
    expect(batch.byBitrixId.size).toBe(0);
    // Каналов не просили — ни каналы, ни сотрудники не спрашиваются.
    expect(contactChannelFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('пустые списки не ходят в базу вовсе', async () => {
    const batch = await loadContacts(prisma, COMPANY, { bitrixIds: [], channels: [] });

    expect(contactFindMany).not.toHaveBeenCalled();
    expect(contactChannelFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
    expect(batch.byId.size).toBe(0);
    expect(batch.channelOwners.size).toBe(0);
    expect(batch.userChannels.size).toBe(0);
  });

  it('каналы и сотрудники ищутся по нормализованным значениям в своей компании', async () => {
    await loadContacts(prisma, COMPANY, {
      bitrixIds: ['201'],
      channels: [{ type: 'phone', normalizedValue: '+79211112233' }],
    });

    expect(contactFindMany.mock.calls[0][0].where).toEqual({
      companyId: COMPANY,
      bitrixId: { in: ['201'] },
    });
    expect(contactChannelFindMany.mock.calls[0][0].where).toEqual({
      companyId: COMPANY,
      normalizedValue: { in: ['+79211112233'] },
    });
    expect(userFindMany.mock.calls[0][0].where).toEqual({
      companyId: COMPANY,
      OR: [{ email: { in: ['+79211112233'] } }, { whatsappPhone: { in: ['+79211112233'] } }],
    });
  });
});

describe('loadLeads / loadDeals / loadTasks / loadDocuments', () => {
  it('пустой список идентификаторов не доходит до базы', async () => {
    expect((await loadLeads(prisma, [])).size).toBe(0);
    expect((await loadDeals(prisma, COMPANY, [])).size).toBe(0);
    expect((await loadTasks(prisma, COMPANY, [])).size).toBe(0);
    expect((await loadDocuments(prisma, COMPANY, [])).size).toBe(0);

    expect(leadFindMany).not.toHaveBeenCalled();
    expect(dealFindMany).not.toHaveBeenCalled();
    expect(taskFindMany).not.toHaveBeenCalled();
    expect(documentFindMany).not.toHaveBeenCalled();
  });

  it('лиды: карта по bitrixId, поиск без фильтра по компании (у лида её нет)', async () => {
    leadFindMany.mockResolvedValue([
      { id: 'l1', subject: 'Обучение', status: 'new', bitrixId: '301' },
    ]);

    const map = await loadLeads(prisma, ['301', '302']);

    expect(map.get('301')).toEqual({
      id: 'l1',
      subject: 'Обучение',
      status: 'new',
      bitrixId: '301',
    });
    expect(map.has('302')).toBe(false);
    expect(leadFindMany.mock.calls[0][0].where).toEqual({ bitrixId: { in: ['301', '302'] } });
  });

  it('сделки: карта по bitrixId, выборка своей компании', async () => {
    dealFindMany.mockResolvedValue([
      {
        id: 'd1',
        title: 'Сделка',
        status: 'won',
        stageId: 's1',
        orderId: null,
        organizationId: 'o1',
        bitrixId: '401',
      },
    ]);

    const map = await loadDeals(prisma, COMPANY, ['401']);

    expect(map.get('401')?.id).toBe('d1');
    expect(dealFindMany.mock.calls[0][0].where).toEqual({
      companyId: COMPANY,
      bitrixId: { in: ['401'] },
    });
  });

  it('задачи: карта по bitrixId, выборка своей компании', async () => {
    taskFindMany.mockResolvedValue([
      { id: 't1', title: 'Задача', status: 'todo', columnId: null, bitrixId: '501' },
    ]);

    const map = await loadTasks(prisma, COMPANY, ['501']);

    expect(map.get('501')?.id).toBe('t1');
    expect(taskFindMany.mock.calls[0][0].where).toEqual({
      companyId: COMPANY,
      bitrixId: { in: ['501'] },
    });
  });

  it('документы: множество известных bitrixId', async () => {
    documentFindMany.mockResolvedValue([{ bitrixId: '701' }, { bitrixId: '703' }]);

    const known = await loadDocuments(prisma, COMPANY, ['701', '702', '703']);

    expect([...known].sort()).toEqual(['701', '703']);
    expect(documentFindMany.mock.calls[0][0].where).toEqual({
      companyId: COMPANY,
      bitrixId: { in: ['701', '702', '703'] },
    });
  });
});

describe('loadOrders', () => {
  it('пустой список организаций не доходит до базы', async () => {
    expect((await loadOrders(prisma, COMPANY, [])).size).toBe(0);
    expect(orderFindMany).not.toHaveBeenCalled();
  });

  it('группирует заказы по организации и приводит сумму к строке', async () => {
    orderFindMany.mockResolvedValue([
      {
        id: 'ord-1',
        organizationId: 'o1',
        externalId: '1c-1',
        orderNumber: '№1',
        totalAmount: { toString: () => '120000' },
        closedAt: new Date('2025-12-20T00:00:00Z'),
        completedAt: null,
      },
      {
        id: 'ord-2',
        organizationId: 'o1',
        externalId: null,
        orderNumber: null,
        totalAmount: 45000,
        closedAt: null,
        completedAt: null,
      },
      {
        id: 'ord-3',
        organizationId: 'o2',
        externalId: 'bitrix:deal:401',
        orderNumber: '№3',
        totalAmount: '9000',
        closedAt: null,
        completedAt: new Date('2026-03-01T00:00:00Z'),
      },
    ]);

    const byOrg = await loadOrders(prisma, COMPANY, ['o1', 'o2']);

    expect(byOrg.get('o1')?.map((o) => [o.id, o.totalAmount])).toEqual([
      ['ord-1', '120000'],
      ['ord-2', '45000'],
    ]);
    expect(byOrg.get('o2')).toHaveLength(1);
    expect(byOrg.get('o2')?.[0].externalId).toBe('bitrix:deal:401');
    expect(orderFindMany.mock.calls[0][0].where).toEqual({
      companyId: COMPANY,
      organizationId: { in: ['o1', 'o2'] },
    });
  });
});

describe('loadCompanyUsers', () => {
  it('только активные сотрудники своей компании из контура менеджера, по алфавиту', async () => {
    userFindMany.mockResolvedValue([{ id: 'u1', email: 'a@demo.local', name: 'Анна' }]);

    await expect(loadCompanyUsers(prisma, COMPANY)).resolves.toEqual([
      { id: 'u1', email: 'a@demo.local', name: 'Анна' },
    ]);
    expect(userFindMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY, isActive: true, role: { in: ['manager', 'leader', 'admin'] } },
      select: { id: true, email: true, name: true },
      orderBy: { name: 'asc' },
    });
  });
});
