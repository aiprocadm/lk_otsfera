import { afterEach, describe, expect, it, vi } from 'vitest';
import { RestBitrixSource } from '@/lib/services/bitrix/adapter-rest';
import type { BitrixClientOptions } from '@/lib/services/bitrix/client';
import { BitrixSourceError, type BitrixFile } from '@/lib/services/bitrix/source';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-189`, `У-199`): источник `rest` — сырые ответы
 * методов Битрикс24 превращаются в нормализованные записи. Транспорт — мок с
 * маршрутами по имени метода из URL; сети нет, ограничитель — на своих часах.
 */

type Transport = NonNullable<BitrixClientOptions['transport']>;
type Handler = (params: any) => unknown;

const BASE = 'https://demo.bitrix24.ru/rest/1/secret-token/';

/** Страница списка по 50 с `next`, как отдаёт Битрикс. */
const paged =
  (rows: unknown[]): Handler =>
  (params: { start?: number }) => {
    const start = params.start ?? 0;
    const next = start + 50 < rows.length ? start + 50 : undefined;
    return {
      result: rows.slice(start, start + 50),
      ...(next !== undefined ? { next } : {}),
      total: rows.length,
    };
  };

/** Ответ `batch`: только те ключи, что спросили в `cmd`. */
const batchOf =
  (results: Record<string, unknown>): Handler =>
  (params: { cmd: Record<string, string> }) => ({
    result: {
      result: Object.fromEntries(
        Object.keys(params.cmd)
          .filter((k) => k in results)
          .map((k) => [k, results[k]])
      ),
    },
  });

function makeSource(routes: Record<string, Handler>, extra: Partial<BitrixClientOptions> = {}) {
  const transport = vi.fn<Transport>(async (url, params) => {
    const method = url.slice(BASE.length);
    const handler = routes[method];
    if (!handler) return { status: 500, body: { error: 'NO_ROUTE', error_description: method } };
    return { status: 200, body: handler(params) };
  });
  let t = 0;
  const source = new RestBitrixSource({
    webhookUrl: BASE,
    transport,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    retries: 0,
    ...extra,
  });
  /** Параметры всех вызовов метода по порядку. */
  const paramsOf = (method: string) =>
    transport.mock.calls.filter(([u]) => u === `${BASE}${method}`).map(([, p]) => p as any);
  return { source, transport, paramsOf };
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of it) out.push(item);
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('check — профиль вебхука', () => {
  it('profile → ok: домен портала (без токена) и имя пользователя', async () => {
    const { source, transport } = makeSource({
      profile: () => ({ result: { ID: '1', NAME: 'Иван', LAST_NAME: 'Менеджеров' } }),
    });
    const res = await source.check();
    expect(res).toEqual({ ok: true, portal: 'demo.bitrix24.ru', user: 'Иван Менеджеров' });
    expect(JSON.stringify(res)).not.toContain('secret-token');
    expect(transport.mock.calls[0][0]).toBe(`${BASE}profile`);
  });

  it('только имя → имя; пустой профиль или без result → «пользователь вебхука»', async () => {
    const onlyName = makeSource({ profile: () => ({ result: { NAME: 'Иван' } }) });
    expect(await onlyName.source.check()).toMatchObject({ ok: true, user: 'Иван' });

    const empty = makeSource({ profile: () => ({ result: {} }) });
    expect(await empty.source.check()).toMatchObject({ ok: true, user: 'пользователь вебхука' });

    const noResult = makeSource({ profile: () => ({}) });
    expect(await noResult.source.check()).toMatchObject({ ok: true, user: 'пользователь вебхука' });
  });

  it('ошибка источника → ok: false с её текстом', async () => {
    const transport = vi.fn<Transport>().mockResolvedValue({ status: 401, body: null });
    const source = new RestBitrixSource({ webhookUrl: BASE, transport, retries: 0 });
    expect(await source.check()).toEqual({ ok: false, message: 'Битрикс24 отклонил вебхук' });
  });

  it('неожиданное исключение (не BitrixSourceError) → общий текст «недоступен»', async () => {
    // Транспорт вернул не объект ответа — разбор падает TypeError'ом, не нашей ошибкой.
    const transport = vi.fn<Transport>().mockResolvedValue(null as any);
    const source = new RestBitrixSource({ webhookUrl: BASE, transport, retries: 0 });
    expect(await source.check()).toEqual({ ok: false, message: 'Битрикс24 недоступен' });
  });
});

describe('users — user.get', () => {
  it('нормализует id, почту (в нижний регистр), имя и активность', async () => {
    const { source, paramsOf } = makeSource({
      'user.get': paged([
        { ID: 1, NAME: 'Иван', LAST_NAME: 'Менеджеров', EMAIL: 'Manager@Demo.Local', ACTIVE: 'Y' },
        { ID: '2', NAME: '', LAST_NAME: '', EMAIL: 'x@y.ru', ACTIVE: 'N' },
        { ID: '3', EMAIL: '' },
        { ID: '4', LAST_NAME: 'Только-Фамилия', ACTIVE: 'false', EMAIL: null },
        // Документация `user.get` описывает ACTIVE булевым — уволенный не должен стать активным.
        { ID: '5', NAME: 'Уволенный', ACTIVE: false, EMAIL: '   ' },
        { ID: '6', NAME: 'Ноль', ACTIVE: '0', EMAIL: 'zero@y.ru' },
      ]),
    });
    expect(await collect(source.users())).toEqual([
      { id: '1', email: 'manager@demo.local', name: 'Иван Менеджеров', active: true },
      { id: '2', email: 'x@y.ru', name: 'x@y.ru', active: false },
      { id: '3', email: null, name: '#3', active: true },
      { id: '4', email: null, name: 'Только-Фамилия', active: false },
      { id: '5', email: null, name: 'Уволенный', active: false },
      { id: '6', email: 'zero@y.ru', name: 'Ноль', active: false },
    ]);
    expect(paramsOf('user.get')).toEqual([{ start: 0 }]);
  });
});

describe('stages — направления, стадии сделок и статусы лидов', () => {
  const statusRoutes = (params: { filter: { ENTITY_ID: string } }) => {
    const byEntity: Record<string, unknown[]> = {
      DEAL_STAGE: [
        { STATUS_ID: 'NEW', NAME: 'Новая', EXTRA: { SEMANTICS: 'process' } },
        { STATUS_ID: 'WON', NAME: 'Успех', EXTRA: { SEMANTICS: 'SUCCESS' } },
        { STATUS_ID: 'LOSE', NAME: 'Провал', EXTRA: { SEMANTICS: 'failure' } },
        { STATUS_ID: 'APOLOGY', NAME: 'Анализ причин', EXTRA: { SEMANTICS: 'apology' } },
      ],
      DEAL_STAGE_1: [
        { STATUS_ID: 'C1:NEW', NAME: 'Новая', SEMANTICS: 'P' },
        { STATUS_ID: 'C1:WON', NAME: 'Успех', SEMANTICS: 's' },
        { STATUS_ID: 'C1:LOSE', NAME: 'Провал', EXTRA: 'строка', SEMANTICS: 'F' },
      ],
      STATUS: [
        { STATUS_ID: 'NEW', NAME: 'Не обработан' },
        {
          STATUS_ID: 'CONVERTED',
          NAME: 'Качественный',
          EXTRA: { SEMANTICS: 'weird' },
          SEMANTICS: 'S',
        },
        { STATUS_ID: 'JUNK', NAME: 'Некачественный', EXTRA: {}, SEMANTICS: 'F' },
      ],
    };
    return paged(byEntity[params.filter.ENTITY_ID] ?? [])(params);
  };

  it('общее направление → categoryId null, остальные → свой id; семантика из EXTRA или короткой буквы', async () => {
    const { source, paramsOf } = makeSource({
      'crm.dealcategory.list': () => ({ result: [{ ID: 1, NAME: 'Второе направление' }] }),
      'crm.status.list': statusRoutes,
    });
    const stages = await source.stages();
    expect(stages).toEqual([
      { entity: 'deal', categoryId: null, id: 'NEW', name: 'Новая', semantics: 'process' },
      { entity: 'deal', categoryId: null, id: 'WON', name: 'Успех', semantics: 'success' },
      { entity: 'deal', categoryId: null, id: 'LOSE', name: 'Провал', semantics: 'failure' },
      {
        entity: 'deal',
        categoryId: null,
        id: 'APOLOGY',
        name: 'Анализ причин',
        semantics: 'apology',
      },
      { entity: 'deal', categoryId: '1', id: 'C1:NEW', name: 'Новая', semantics: 'process' },
      { entity: 'deal', categoryId: '1', id: 'C1:WON', name: 'Успех', semantics: 'success' },
      { entity: 'deal', categoryId: '1', id: 'C1:LOSE', name: 'Провал', semantics: 'failure' },
      { entity: 'lead', categoryId: null, id: 'NEW', name: 'Не обработан', semantics: 'process' },
      {
        entity: 'lead',
        categoryId: null,
        id: 'CONVERTED',
        name: 'Качественный',
        semantics: 'success',
      },
      {
        entity: 'lead',
        categoryId: null,
        id: 'JUNK',
        name: 'Некачественный',
        semantics: 'failure',
      },
    ]);
    expect(paramsOf('crm.dealcategory.list')).toEqual([{ select: ['ID', 'NAME'] }]);
    expect(paramsOf('crm.status.list').map((p) => p.filter.ENTITY_ID)).toEqual([
      'DEAL_STAGE',
      'DEAL_STAGE_1',
      'STATUS',
    ]);
  });

  it('направления не пришли (result не массив) → только общее направление и лиды', async () => {
    const { source, paramsOf } = makeSource({
      'crm.dealcategory.list': () => ({}),
      'crm.status.list': statusRoutes,
    });
    const stages = await source.stages();
    expect(stages.filter((s) => s.entity === 'deal')).toHaveLength(4);
    expect(stages.filter((s) => s.entity === 'lead')).toHaveLength(3);
    expect(paramsOf('crm.status.list').map((p) => p.filter.ENTITY_ID)).toEqual([
      'DEAL_STAGE',
      'STATUS',
    ]);
  });
});

describe('companies — crm.company.list + реквизиты', () => {
  const companies = [
    {
      ID: '101',
      TITLE: ' ООО «Альфа» ',
      ASSIGNED_BY_ID: '1',
      DATE_CREATE: '2025-11-03T09:00:00+03:00',
      COMMENTS: 'Крупный клиент',
    },
    { ID: 102, TITLE: '', ASSIGNED_BY_ID: '', DATE_CREATE: 'не дата', COMMENTS: '   ' },
    { ID: '103', TITLE: 'Гамма' },
  ];
  const requisites = [
    { ENTITY_ID: '101', RQ_INN: '7701234567', RQ_KPP: '770101001' },
    // Второй реквизит той же компании — игнорируется (первый выигрывает).
    { ENTITY_ID: '101', RQ_INN: '9999999999', RQ_KPP: '' },
    { ENTITY_ID: 102, RQ_INN: '', RQ_KPP: null },
  ];

  it('ИНН/КПП подтягиваются из реквизитов по ENTITY_ID, пустые → null, название по умолчанию', async () => {
    const { source, paramsOf } = makeSource({
      'crm.company.list': paged(companies),
      'crm.requisite.list': paged(requisites),
    });
    expect(await collect(source.companies({}))).toEqual([
      {
        id: '101',
        title: 'ООО «Альфа»',
        inn: '7701234567',
        kpp: '770101001',
        assignedById: '1',
        createdAt: new Date('2025-11-03T06:00:00Z'),
        comments: 'Крупный клиент',
      },
      {
        id: '102',
        title: 'Компания #102',
        inn: null,
        kpp: null,
        assignedById: null,
        createdAt: null,
        comments: null,
      },
      {
        id: '103',
        title: 'Гамма',
        inn: null,
        kpp: null,
        assignedById: null,
        createdAt: null,
        comments: null,
      },
    ]);
    expect(paramsOf('crm.company.list')).toEqual([
      {
        select: ['ID', 'TITLE', 'ASSIGNED_BY_ID', 'DATE_CREATE', 'COMMENTS'],
        filter: {},
        order: { ID: 'ASC' },
        start: 0,
      },
    ]);
    expect(paramsOf('crm.requisite.list')).toEqual([
      {
        filter: { ENTITY_TYPE_ID: 4, '@ENTITY_ID': ['101', '102', '103'] },
        select: ['ENTITY_ID', 'RQ_INN', 'RQ_KPP'],
        start: 0,
      },
    ]);
  });

  it('период: from/to → фильтр >=DATE_CREATE / <=DATE_CREATE в ISO', async () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-02-01T00:00:00Z');
    const both = makeSource({ 'crm.company.list': paged([]) });
    await collect(both.source.companies({ from, to }));
    expect(both.paramsOf('crm.company.list')[0].filter).toEqual({
      '>=DATE_CREATE': '2026-01-01T00:00:00.000Z',
      '<=DATE_CREATE': '2026-02-01T00:00:00.000Z',
    });

    const onlyFrom = makeSource({ 'crm.company.list': paged([]) });
    await collect(onlyFrom.source.companies({ from }));
    expect(onlyFrom.paramsOf('crm.company.list')[0].filter).toEqual({
      '>=DATE_CREATE': '2026-01-01T00:00:00.000Z',
    });
    // Пустой список — реквизиты не спрашиваются вовсе.
    expect(onlyFrom.paramsOf('crm.requisite.list')).toEqual([]);
  });

  it('51 компания → реквизиты двумя пачками (50 + 1), порядок сохранён', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({ ID: String(1000 + i), TITLE: `К${i}` }));
    const { source, paramsOf } = makeSource({
      'crm.company.list': paged(rows),
      'crm.requisite.list': paged([{ ENTITY_ID: '1050', RQ_INN: '5', RQ_KPP: '6' }]),
    });
    const out = await collect(source.companies({}));
    expect(out.map((c) => c.id)).toEqual(rows.map((r) => r.ID));
    expect(out[50]).toMatchObject({ id: '1050', inn: '5', kpp: '6' });
    expect(paramsOf('crm.company.list').map((p) => p.start)).toEqual([0, 50]);
    const rq = paramsOf('crm.requisite.list').map((p) => p.filter['@ENTITY_ID'].length);
    expect(rq).toEqual([50, 1]);
  });

  it('ровно 50 компаний → одна пачка реквизитов, финальный сброс пуст', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ ID: String(i), TITLE: `К${i}` }));
    const { source, paramsOf } = makeSource({
      'crm.company.list': paged(rows),
      'crm.requisite.list': paged([]),
    });
    expect(await collect(source.companies({}))).toHaveLength(50);
    expect(paramsOf('crm.requisite.list')).toHaveLength(1);
  });

  it('защитная ветка: реквизиты для пустого списка id не ходят в сеть', async () => {
    const { source, transport } = makeSource({});
    const map = await (source as any).requisitesFor([]);
    expect(map.size).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('contacts — crm.contact.list', () => {
  it('мультиполя PHONE/EMAIL → строки без пустых, COMPANY_ID «0» → null, обрезка пробелов', async () => {
    const { source, paramsOf } = makeSource({
      'crm.contact.list': paged([
        {
          ID: '201',
          NAME: ' Анна ',
          LAST_NAME: ' Иванова ',
          POST: 'Директор',
          COMPANY_ID: '101',
          PHONE: [
            { VALUE: ' +7 921 ', VALUE_TYPE: 'WORK' },
            { VALUE: '' },
            null,
            'строка',
            { VALUE_TYPE: 'HOME' },
          ],
          EMAIL: [{ VALUE: 'Ivanova@Alfa.LOCAL' }],
          ASSIGNED_BY_ID: 1,
          DATE_CREATE: '2025-11-03T09:10:00Z',
        },
        { ID: '202', COMPANY_ID: '0', PHONE: 'не массив', POST: '' },
        { ID: '203', COMPANY_ID: '' },
      ]),
    });
    expect(await collect(source.contacts({ to: new Date('2026-01-01T00:00:00Z') }))).toEqual([
      {
        id: '201',
        name: 'Анна',
        lastName: 'Иванова',
        post: 'Директор',
        companyId: '101',
        phones: ['+7 921'],
        emails: ['ivanova@alfa.local'],
        assignedById: '1',
        createdAt: new Date('2025-11-03T09:10:00Z'),
      },
      {
        id: '202',
        name: '',
        lastName: '',
        post: null,
        companyId: null,
        phones: [],
        emails: [],
        assignedById: null,
        createdAt: null,
      },
      {
        id: '203',
        name: '',
        lastName: '',
        post: null,
        companyId: null,
        phones: [],
        emails: [],
        assignedById: null,
        createdAt: null,
      },
    ]);
    expect(paramsOf('crm.contact.list')).toEqual([
      {
        select: [
          'ID',
          'NAME',
          'LAST_NAME',
          'POST',
          'COMPANY_ID',
          'ASSIGNED_BY_ID',
          'DATE_CREATE',
          'PHONE',
          'EMAIL',
        ],
        filter: { '<=DATE_CREATE': '2026-01-01T00:00:00.000Z' },
        order: { ID: 'ASC' },
        start: 0,
      },
    ]);
  });
});

describe('leads — crm.lead.list', () => {
  it('имя склеивается из NAME и LAST_NAME, сумма и ИНН строками, пустое → null', async () => {
    const { source, paramsOf } = makeSource({
      'crm.lead.list': paged([
        {
          ID: '301',
          TITLE: ' Обучение по ОТ ',
          NAME: ' Анна ',
          LAST_NAME: 'Иванова ',
          COMPANY_TITLE: 'ООО «Альфа»',
          STATUS_ID: 'NEW',
          ASSIGNED_BY_ID: '1',
          OPPORTUNITY: 120000,
          DATE_CREATE: '2025-10-01T09:00:00Z',
          COMMENTS: 'Звонил сам',
          PHONE: [{ VALUE: '+7 911' }],
          EMAIL: [{ VALUE: 'A@B.RU' }],
          UF_CRM_INN: ' 7701234567 ',
        },
        { ID: '302', NAME: '', LAST_NAME: 'Петров', OPPORTUNITY: '' },
        { ID: 303 },
      ]),
    });
    expect(await collect(source.leads({}))).toEqual([
      {
        id: '301',
        title: 'Обучение по ОТ',
        name: 'Анна Иванова',
        companyTitle: 'ООО «Альфа»',
        phones: ['+7 911'],
        emails: ['a@b.ru'],
        inn: '7701234567',
        statusId: 'NEW',
        assignedById: '1',
        opportunity: '120000',
        createdAt: new Date('2025-10-01T09:00:00Z'),
        comments: 'Звонил сам',
      },
      {
        id: '302',
        title: '',
        name: 'Петров',
        companyTitle: null,
        phones: [],
        emails: [],
        inn: null,
        statusId: '',
        assignedById: null,
        opportunity: null,
        createdAt: null,
        comments: null,
      },
      {
        id: '303',
        title: '',
        name: '',
        companyTitle: null,
        phones: [],
        emails: [],
        inn: null,
        statusId: '',
        assignedById: null,
        opportunity: null,
        createdAt: null,
        comments: null,
      },
    ]);
    const p = paramsOf('crm.lead.list')[0];
    expect(p.select).toEqual([
      'ID',
      'TITLE',
      'NAME',
      'LAST_NAME',
      'COMPANY_TITLE',
      'STATUS_ID',
      'ASSIGNED_BY_ID',
      'OPPORTUNITY',
      'DATE_CREATE',
      'COMMENTS',
      'PHONE',
      'EMAIL',
      'UF_CRM_INN',
    ]);
    expect(p.order).toEqual({ ID: 'ASC' });
  });
});

describe('deals — crm.deal.list', () => {
  const deals = [
    {
      ID: '401',
      TITLE: ' Сделка ',
      CATEGORY_ID: '2',
      STAGE_ID: 'C2:WON',
      OPPORTUNITY: '120000.00',
      COMPANY_ID: '101',
      CONTACT_ID: '201',
      LEAD_ID: '301',
      ASSIGNED_BY_ID: '1',
      DATE_CREATE: '2025-10-05T09:00:00Z',
      CLOSEDATE: '2025-12-20T00:00:00Z',
      CLOSED: 'Y',
      COMMENTS: 'ok',
    },
    {
      ID: '402',
      CATEGORY_ID: '',
      STAGE_ID: 'NEW',
      COMPANY_ID: '0',
      CONTACT_ID: '0',
      LEAD_ID: '0',
      CLOSED: 'N',
    },
    { ID: '403', CATEGORY_ID: 0 },
  ];

  it('нормализация: CATEGORY_ID пусто → «0», ссылки «0» → null, CLOSED только по «Y»', async () => {
    const { source, paramsOf } = makeSource({ 'crm.deal.list': paged(deals) });
    expect(await collect(source.deals({}))).toEqual([
      {
        id: '401',
        title: 'Сделка',
        categoryId: '2',
        stageId: 'C2:WON',
        opportunity: '120000.00',
        companyId: '101',
        contactId: '201',
        leadId: '301',
        assignedById: '1',
        createdAt: new Date('2025-10-05T09:00:00Z'),
        closeDate: new Date('2025-12-20T00:00:00Z'),
        closed: true,
        comments: 'ok',
      },
      {
        id: '402',
        title: '',
        categoryId: '0',
        stageId: 'NEW',
        opportunity: null,
        companyId: null,
        contactId: null,
        leadId: null,
        assignedById: null,
        createdAt: null,
        closeDate: null,
        closed: false,
        comments: null,
      },
      {
        id: '403',
        title: '',
        categoryId: '0',
        stageId: '',
        opportunity: null,
        companyId: null,
        contactId: null,
        leadId: null,
        assignedById: null,
        createdAt: null,
        closeDate: null,
        closed: false,
        comments: null,
      },
    ]);
    const p = paramsOf('crm.deal.list')[0];
    expect(p.filter).toEqual({});
    expect(p.order).toEqual({ ID: 'ASC' });
    expect(p.select).toContain('CLOSEDATE');
  });

  it('openOnly → фильтр CLOSED: N вместе с периодом', async () => {
    const { source, paramsOf } = makeSource({ 'crm.deal.list': paged([]) });
    await collect(source.deals({ openOnly: true, from: new Date('2026-01-01T00:00:00Z') }));
    expect(paramsOf('crm.deal.list')[0].filter).toEqual({
      '>=DATE_CREATE': '2026-01-01T00:00:00.000Z',
      CLOSED: 'N',
    });
  });
});

describe('tasks — tasks.task.list', () => {
  it('поля в camelCase и UPPER читаются одинаково; статус из словаря; UF_CRM_TASK → связи', async () => {
    const { source, paramsOf } = makeSource({
      'tasks.task.list': paged([
        {
          id: 501,
          title: ' Отправить КП ',
          description: 'По итогам звонка',
          status: '5',
          responsibleId: 1,
          createdBy: '2',
          deadline: '2025-10-10T00:00:00Z',
          createdDate: '2025-10-06T09:00:00Z',
          closedDate: '2025-10-09T15:00:00Z',
          ufCrmTask: ['CO_101', 'D_401', 'L_303', 'C_208', 'X_1', 'junk', 5, null, 'CO_'],
        },
        { ID: '502', TITLE: '', STATUS: 3, UF_CRM_TASK: 'не массив' },
        { ID: '503', STATUS: '7' },
        { ID: '504', STATUS: 4 },
        { ID: '505', STATUS: '6' },
        { ID: '506' },
        // UPPER-вариант приоритетнее camelCase, если задан.
        { ID: '507', id: '999', TITLE: 'Верх', title: 'низ', STATUS: 2, status: 5 },
      ]),
    });
    const tasks = await collect(source.tasks({}));
    expect(tasks[0]).toEqual({
      id: '501',
      title: 'Отправить КП',
      description: 'По итогам звонка',
      status: 5,
      responsibleId: '1',
      createdById: '2',
      deadline: new Date('2025-10-10T00:00:00Z'),
      createdAt: new Date('2025-10-06T09:00:00Z'),
      closedAt: new Date('2025-10-09T15:00:00Z'),
      crmLinks: [
        { kind: 'company', id: '101' },
        { kind: 'deal', id: '401' },
        { kind: 'lead', id: '303' },
        { kind: 'contact', id: '208' },
      ],
    });
    expect(tasks[1]).toEqual({
      id: '502',
      title: 'Задача #502',
      description: null,
      status: 3,
      responsibleId: null,
      createdById: null,
      deadline: null,
      createdAt: null,
      closedAt: null,
      crmLinks: [],
    });
    expect(tasks.slice(2).map((t) => [t.id, t.status])).toEqual([
      ['503', 2],
      ['504', 4],
      ['505', 6],
      ['506', 2],
      ['507', 2],
    ]);
    expect(tasks[6].title).toBe('Верх');
    const p = paramsOf('tasks.task.list')[0];
    expect(p).toEqual({
      select: [
        'ID',
        'TITLE',
        'DESCRIPTION',
        'STATUS',
        'RESPONSIBLE_ID',
        'CREATED_BY',
        'DEADLINE',
        'CREATED_DATE',
        'CLOSED_DATE',
        'UF_CRM_TASK',
      ],
      filter: {},
      order: { ID: 'asc' },
      start: 0,
    });
  });

  it('openOnly → !REAL_STATUS: 5; период — по CREATED_DATE', async () => {
    const { source, paramsOf } = makeSource({ 'tasks.task.list': paged([]) });
    await collect(
      source.tasks({
        openOnly: true,
        from: new Date('2026-01-01T00:00:00Z'),
        to: new Date('2026-02-01T00:00:00Z'),
      })
    );
    expect(paramsOf('tasks.task.list')[0].filter).toEqual({
      '>=CREATED_DATE': '2026-01-01T00:00:00.000Z',
      '<=CREATED_DATE': '2026-02-01T00:00:00.000Z',
      '!REAL_STATUS': 5,
    });
  });
});

describe('comments — crm.timeline.comment.list через batch', () => {
  it('ключи c<id>; пустые тексты пропускаются; не-массив и отсутствующий ответ — молча', async () => {
    const { source, paramsOf } = makeSource({
      batch: batchOf({
        c401: [
          {
            ID: '601',
            COMMENT: ' Клиент подтвердил ',
            AUTHOR_ID: '1',
            CREATED: '2025-10-07T10:00:00Z',
          },
          { ID: '602', COMMENT: '   ' },
          { ID: 603, COMMENT: 'Без автора', AUTHOR_ID: '', CREATED: 'кривая дата' },
        ],
        c402: 'не массив',
      }),
    });
    expect(await collect(source.comments('deal', ['401', '402', '403']))).toEqual([
      {
        id: '601',
        entity: 'deal',
        entityId: '401',
        authorId: '1',
        text: 'Клиент подтвердил',
        createdAt: new Date('2025-10-07T10:00:00Z'),
      },
      {
        id: '603',
        entity: 'deal',
        entityId: '401',
        authorId: null,
        text: 'Без автора',
        createdAt: null,
      },
    ]);
    const [call] = paramsOf('batch');
    expect(call.halt).toBe(0);
    expect(call.cmd).toEqual({
      c401: 'crm.timeline.comment.list?filter[ENTITY_TYPE]=deal&filter[ENTITY_ID]=401&order[ID]=ASC',
      c402: 'crm.timeline.comment.list?filter[ENTITY_TYPE]=deal&filter[ENTITY_ID]=402&order[ID]=ASC',
      c403: 'crm.timeline.comment.list?filter[ENTITY_TYPE]=deal&filter[ENTITY_ID]=403&order[ID]=ASC',
    });
  });

  it('больше 50 сущностей → несколько пакетов; пустой список — ни одного запроса', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => String(i));
    const { source, paramsOf } = makeSource({
      batch: batchOf({
        c0: [{ ID: '1', COMMENT: 'первый' }],
        c50: [{ ID: '2', COMMENT: 'последний' }],
      }),
    });
    const out = await collect(source.comments('company', ids));
    expect(out.map((c) => [c.entityId, c.text])).toEqual([
      ['0', 'первый'],
      ['50', 'последний'],
    ]);
    expect(paramsOf('batch').map((p) => Object.keys(p.cmd).length)).toEqual([50, 1]);
    expect(paramsOf('batch')[0].cmd.c0).toContain('filter[ENTITY_TYPE]=company');

    const empty = makeSource({});
    expect(await collect(empty.source.comments('contact', []))).toEqual([]);
    expect(empty.transport).not.toHaveBeenCalled();
  });
});

describe('files — вложения таймлайна + disk.attachedObject.get', () => {
  it('собирает id файлов из FILES (id или ID), дочитывает карточки; мусор пропускается', async () => {
    const { source, paramsOf } = makeSource({
      batch: batchOf({
        f101: [
          {
            ID: '1',
            FILES: {
              '0': { id: 701 },
              '1': { ID: '702' },
              '2': 'junk',
              '3': { name: 'без id' },
              '4': null,
            },
          },
          { ID: '2', FILES: null },
          { ID: '3', FILES: 'строка' },
        ],
        f102: 'junk',
        f103: [],
        d701: {
          ID: '701',
          NAME: 'договор.pdf',
          SIZE: '1024',
          DOWNLOAD_URL: 'https://demo.bitrix24.ru/disk/701',
        },
        // d702 не пришёл — файл пропускается.
      }),
    });
    expect(await collect(source.files('company', ['101', '102', '103']))).toEqual([
      {
        id: '701',
        entity: 'company',
        entityId: '101',
        name: 'договор.pdf',
        size: 1024,
        downloadUrl: 'https://demo.bitrix24.ru/disk/701',
      },
    ]);
    const [first, second] = paramsOf('batch');
    expect(first.cmd).toEqual({
      f101: 'crm.timeline.comment.list?filter[ENTITY_TYPE]=company&filter[ENTITY_ID]=101&select[]=ID&select[]=FILES',
      f102: 'crm.timeline.comment.list?filter[ENTITY_TYPE]=company&filter[ENTITY_ID]=102&select[]=ID&select[]=FILES',
      f103: 'crm.timeline.comment.list?filter[ENTITY_TYPE]=company&filter[ENTITY_ID]=103&select[]=ID&select[]=FILES',
    });
    expect(second.cmd).toEqual({
      d701: 'disk.attachedObject.get?id=701',
      d702: 'disk.attachedObject.get?id=702',
    });
  });

  it('карточка файла: id из ID → OBJECT_ID → id вложения; имя по умолчанию; размер — только неотрицательное число', async () => {
    const { source } = makeSource({
      batch: batchOf({
        f401: [
          { ID: '1', FILES: { a: { id: '1' }, b: { id: '2' }, c: { id: '3' }, d: { id: '4' } } },
        ],
        d1: { OBJECT_ID: '9', SIZE: 'abc', DOWNLOAD_URL: '' },
        d2: {},
        d3: { ID: 5, SIZE: 2048, NAME: '', DOWNLOAD_URL: 'https://x/3' },
        d4: { ID: '4', SIZE: -5 },
      }),
    });
    const out = await collect(source.files('deal', ['401']));
    expect(out).toEqual([
      { id: '9', entity: 'deal', entityId: '401', name: 'file-1', size: null, downloadUrl: null },
      // SIZE отсутствует → размера нет (null), а не «0 байт».
      { id: '2', entity: 'deal', entityId: '401', name: 'file-2', size: null, downloadUrl: null },
      {
        id: '5',
        entity: 'deal',
        entityId: '401',
        name: 'file-3',
        size: 2048,
        downloadUrl: 'https://x/3',
      },
      { id: '4', entity: 'deal', entityId: '401', name: 'file-4', size: null, downloadUrl: null },
    ]);
  });

  it('больше 50 вложений → карточки читаются двумя пакетами; без вложений — второго запроса нет', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [String(i), { id: String(i) }])
    );
    const infos = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [`d${i}`, { ID: String(i), NAME: `f${i}.pdf`, SIZE: i }])
    );
    const many = makeSource({ batch: batchOf({ f401: [{ ID: '1', FILES: files }], ...infos }) });
    const out = await collect(many.source.files('deal', ['401']));
    expect(out).toHaveLength(51);
    expect(out[50]).toMatchObject({ id: '50', name: 'f50.pdf', size: 50 });
    expect(many.paramsOf('batch').map((p) => Object.keys(p.cmd).length)).toEqual([1, 50, 1]);

    const none = makeSource({ batch: batchOf({ f401: [{ ID: '1', FILES: {} }] }) });
    expect(await collect(none.source.files('deal', ['401']))).toEqual([]);
    expect(none.paramsOf('batch')).toHaveLength(1);

    const empty = makeSource({});
    expect(await collect(empty.source.files('deal', []))).toEqual([]);
    expect(empty.transport).not.toHaveBeenCalled();
  });
});

describe('download — скачивание по DOWNLOAD_URL', () => {
  const file: BitrixFile = {
    id: '701',
    entity: 'deal',
    entityId: '401',
    name: 'договор.pdf',
    size: 8,
    downloadUrl: 'https://demo.bitrix24.ru/disk/701?token=abc',
  };

  it('без ссылки → api-ошибка с именем файла, fetch не зовётся', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { source } = makeSource({});
    await expect(source.download({ ...file, downloadUrl: null })).rejects.toMatchObject({
      code: 'api',
      message: 'У файла «договор.pdf» нет ссылки скачивания',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTTP не ok → api-ошибка со статусом, без URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const { source } = makeSource({});
    let err: unknown;
    try {
      await source.download(file);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BitrixSourceError);
    const failure = err as BitrixSourceError;
    expect(failure.code).toBe('api');
    expect(failure.message).toBe('Файл «договор.pdf» не скачался: HTTP 404');
    expect(failure.message).not.toContain('token=abc');
  });

  it('ok → Buffer с содержимым; fetch зовётся по ссылке файла', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4\n%%EOF');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer,
    });
    vi.stubGlobal('fetch', fetchMock);
    const { source } = makeSource({});
    const buf = await source.download(file);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(fetchMock).toHaveBeenCalledWith(file.downloadUrl);
  });
});
