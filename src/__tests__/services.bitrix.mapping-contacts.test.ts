import type { ContactChannelType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { NO_NAME, channelConflicts, planContact } from '@/lib/services/bitrix/mapping/contacts';
import type {
  ChannelOwnerRef,
  ContactData,
  ContactLookup,
  ExistingContact,
} from '@/lib/services/bitrix/mapping/contacts';
import type { MappingContext, Plan } from '@/lib/services/bitrix/mapping/types';
import type { BitrixContact } from '@/lib/services/bitrix/source';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-191`, спека §3.3): контакт Битрикса → `Contact`
 * с каналами связи.
 *
 * Канал — то, по чему контакт узнаётся. Совпал с контактом БЕЗ `bitrixId` —
 * «это он»; занят контактом с ДРУГИМ `bitrixId` — остаётся у хозяина, а строка
 * уезжает в конфликты, иначе перенос молча переклеил бы телефон между людьми.
 *
 * Нормализованные значения ниже посчитаны той же функцией, что и в бою
 * (`normalizeChannelValue`): телефон → только цифры с `+` и `8…` → `+7…`,
 * почта → обрезанный нижний регистр.
 */

const COMPANY_ID = 'co-1';

const ctxOf = (over: Partial<MappingContext> = {}): MappingContext => ({
  companyId: COMPANY_ID,
  importerId: 'u-importer',
  defaultManagerId: 'u-manager',
  tables: { stageMap: {}, leadStageMap: {}, taskColumnMap: {}, userMap: {} },
  resolveUser: () => null,
  ...over,
});

const contactOf = (over: Partial<BitrixContact> = {}): BitrixContact => ({
  id: '42',
  name: 'Иван',
  lastName: 'Петров',
  post: null,
  companyId: null,
  phones: [],
  emails: [],
  assignedById: null,
  createdAt: null,
  ...over,
});

const existingOf = (over: Partial<ExistingContact> = {}): ExistingContact => ({
  id: 'c-1',
  name: 'Иван Петров',
  position: null,
  organizationId: null,
  bitrixId: null,
  ...over,
});

const lookupOf = (over: Partial<ContactLookup> = {}): ContactLookup => ({
  byBitrixId: () => undefined,
  channelOwner: () => undefined,
  contactById: () => undefined,
  isUserChannel: () => false,
  organizationByBitrixId: () => undefined,
  ...over,
});

/** Владельцы каналов по ключу «тип:нормализованное значение» — как в `loadContacts`. */
const ownersOf =
  (entries: Record<string, ChannelOwnerRef>) =>
  (type: ContactChannelType, normalizedValue: string): ChannelOwnerRef | undefined =>
    entries[`${type}:${normalizedValue}`];

describe('planContact — имя контакта', () => {
  it.each([
    ['имя и фамилия', 'Иван', 'Петров', 'Иван Петров'],
    ['только имя', 'Иван', '', 'Иван'],
    ['только фамилия', '', 'Петров', 'Петров'],
    ['лишние пробелы обрезаются', '  Иван  ', '  Петров ', 'Иван Петров'],
    ['пробелы вместо фамилии', 'Иван', '   ', 'Иван'],
  ] as const)('%s → «%s»', (_name, name, lastName, expected) => {
    const plan = planContact(contactOf({ name, lastName }), ctxOf(), lookupOf());
    expect(plan).toMatchObject({ action: 'create', data: { name: expected } });
  });

  it('ни имени, ни фамилии, но есть канал → «Без имени»', () => {
    expect(NO_NAME).toBe('Без имени');
    const plan = planContact(
      contactOf({ name: '', lastName: '', phones: ['+7 999 111-22-33'] }),
      ctxOf(),
      lookupOf()
    );
    expect(plan).toMatchObject({ action: 'create', data: { name: NO_NAME } });
  });
});

describe('planContact — пустая запись', () => {
  it('ни имени, ни каналов → пропуск', () => {
    const plan = planContact(contactOf({ name: '', lastName: '' }), ctxOf(), lookupOf());
    expect(plan).toEqual({ action: 'skip', reason: 'empty' });
  });

  it('имя есть, каналов нет → контакт всё равно нужен', () => {
    const plan = planContact(contactOf(), ctxOf(), lookupOf());
    expect(plan).toMatchObject({ action: 'create', data: { name: 'Иван Петров', channels: [] } });
  });

  it('все каналы отсеялись как мусор и имени нет → пропуск', () => {
    const plan = planContact(
      contactOf({ name: '', lastName: '', phones: ['   ', 'нет телефона'], emails: [''] }),
      ctxOf(),
      lookupOf()
    );
    expect(plan).toEqual({ action: 'skip', reason: 'empty' });
  });

  it('единственный канал принадлежит сотруднику ЛК и имени нет → пропуск', () => {
    const plan = planContact(
      contactOf({ name: '', lastName: '', emails: ['manager@example.ru'] }),
      ctxOf(),
      lookupOf({ isUserChannel: () => true })
    );
    expect(plan).toEqual({ action: 'skip', reason: 'empty' });
  });

  it('единственный канал занят чужим контактом и имени нет → нужно решение, а не тихий пропуск', () => {
    // Если бы такая запись просто пропускалась, человек никогда не узнал бы,
    // что телефон остался у другого контакта: `channelConflicts` для пропуска
    // молчит по определению.
    const plan = planContact(
      contactOf({ name: '', lastName: '', phones: ['+7 999 111-22-33'], emails: [] }),
      ctxOf(),
      lookupOf({
        channelOwner: () => ({ contactId: 'c-9', contactName: 'Ольга', bitrixId: '77' }),
      })
    );

    expect(plan).toMatchObject({ action: 'conflict', reason: 'channel_taken' });
    expect(plan.action === 'conflict' ? plan.hint : '').toContain('Ольга');
  });
});

describe('planContact — каналы связи', () => {
  it('телефон сохраняется исходным, а рядом — нормализованное значение', () => {
    const plan = planContact(
      contactOf({ phones: ['  +7 (999) 111-22-33  '] }),
      ctxOf(),
      lookupOf()
    );
    expect(plan).toMatchObject({
      action: 'create',
      data: {
        channels: [{ type: 'phone', value: '+7 (999) 111-22-33', normalizedValue: '+79991112233' }],
      },
    });
  });

  it('почта нормализуется в нижний регистр', () => {
    const plan = planContact(contactOf({ emails: [' IvAn@Example.RU '] }), ctxOf(), lookupOf());
    expect(plan).toMatchObject({
      action: 'create',
      data: {
        channels: [{ type: 'email', value: 'IvAn@Example.RU', normalizedValue: 'ivan@example.ru' }],
      },
    });
  });

  it('сначала телефоны, потом почты — порядок разбора записи', () => {
    const plan = planContact(
      contactOf({ phones: ['+79991112233'], emails: ['ivan@example.ru'] }),
      ctxOf(),
      lookupOf()
    );
    expect(plan).toMatchObject({ action: 'create' });
    if (plan.action !== 'create') throw new Error('ожидалось создание');
    expect(plan.data.channels.map((c) => c.type)).toEqual(['phone', 'email']);
  });

  it.each([
    ['два написания одного номера', ['+7 (999) 111-22-33', '89991112233'], '+79991112233'],
    ['один и тот же номер дважды', ['+79991112233', '+79991112233'], '+79991112233'],
  ] as const)('дубли внутри записи схлопываются: %s', (_name, phones, normalized) => {
    const plan = planContact(contactOf({ phones: [...phones] }), ctxOf(), lookupOf());
    expect(plan).toMatchObject({ action: 'create' });
    if (plan.action !== 'create') throw new Error('ожидалось создание');
    expect(plan.data.channels).toHaveLength(1);
    expect(plan.data.channels[0].normalizedValue).toBe(normalized);
  });

  it('почта в разном регистре — тоже один канал', () => {
    const plan = planContact(
      contactOf({ emails: ['Ivan@Example.ru', 'ivan@example.RU'] }),
      ctxOf(),
      lookupOf()
    );
    expect(plan).toMatchObject({ action: 'create' });
    if (plan.action !== 'create') throw new Error('ожидалось создание');
    expect(plan.data.channels).toHaveLength(1);
    expect(plan.data.channels[0].value).toBe('Ivan@Example.ru');
  });

  it.each([
    ['пустая строка', ''],
    ['одни пробелы', '   '],
    ['текст без цифр', 'нет телефона'],
  ] as const)('мусорный телефон (%s) каналом не становится', (_name, phone) => {
    const plan = planContact(contactOf({ phones: [phone] }), ctxOf(), lookupOf());
    expect(plan).toMatchObject({ action: 'create', data: { channels: [] } });
  });

  it('канал сотрудника ЛК не заводится контакту — он принадлежит профилю', () => {
    const isUserChannel = vi.fn(
      (type: ContactChannelType, value: string) => type === 'email' && value === 'ivan@example.ru'
    );
    const plan = planContact(
      contactOf({ phones: ['+79991112233'], emails: ['Ivan@example.ru'] }),
      ctxOf(),
      lookupOf({ isUserChannel })
    );
    expect(plan).toMatchObject({ action: 'create' });
    if (plan.action !== 'create') throw new Error('ожидалось создание');
    expect(plan.data.channels.map((c) => c.type)).toEqual(['phone']);
    expect(isUserChannel).toHaveBeenCalledWith('email', 'ivan@example.ru');
  });
});

describe('planContact — канал занят другим контактом', () => {
  it('хозяин с ДРУГИМ bitrixId: канал остаётся у него, контакт создаётся с остальными', () => {
    const plan = planContact(
      contactOf({ phones: ['+7 999 111-22-33', '+7 999 222-33-44'] }),
      ctxOf(),
      lookupOf({
        channelOwner: ownersOf({
          'phone:+79991112233': { contactId: 'c-9', contactName: 'Ольга', bitrixId: '77' },
        }),
      })
    );
    expect(plan).toMatchObject({
      action: 'create',
      data: {
        channels: [{ value: '+7 999 222-33-44', normalizedValue: '+79992223344' }],
        skippedChannels: [{ value: '+7 999 111-22-33', owner: 'Ольга' }],
      },
    });
  });

  it('хозяин БЕЗ bitrixId — это он: план обновления с дописыванием bitrixId', () => {
    const contactById = vi.fn(() => existingOf({ id: 'c-9', name: 'Иван Петров' }));
    const plan = planContact(
      contactOf({ phones: ['+7 999 111-22-33'] }),
      ctxOf(),
      lookupOf({
        channelOwner: ownersOf({
          'phone:+79991112233': { contactId: 'c-9', contactName: 'Иван Петров', bitrixId: null },
        }),
        contactById,
      })
    );
    expect(contactById).toHaveBeenCalledWith('c-9');
    expect(plan).toEqual({
      action: 'update',
      id: 'c-9',
      data: { bitrixId: '42' },
      before: { bitrixId: null },
    });
  });

  it('хозяин с ТЕМ ЖЕ bitrixId — канал не отбирается и в конфликты не идёт', () => {
    const plan = planContact(
      contactOf({ phones: ['+7 999 111-22-33'] }),
      ctxOf(),
      lookupOf({
        byBitrixId: () => existingOf({ id: 'c-1', bitrixId: '42' }),
        channelOwner: ownersOf({
          'phone:+79991112233': { contactId: 'c-1', contactName: 'Иван Петров', bitrixId: '42' },
        }),
      })
    );
    expect(plan).toEqual({ action: 'skip', reason: 'no_changes' });
  });

  it('уже сопоставленный по bitrixId контакт не переспрашивается по каналу', () => {
    const contactById = vi.fn(() => undefined);
    planContact(
      contactOf({ phones: ['+7 999 111-22-33'], name: 'Иван', lastName: 'Петров' }),
      ctxOf(),
      lookupOf({
        byBitrixId: () => existingOf({ id: 'c-1', bitrixId: '42' }),
        channelOwner: ownersOf({
          'phone:+79991112233': { contactId: 'c-9', contactName: 'Иван Петров', bitrixId: null },
        }),
        contactById,
      })
    );
    expect(contactById).not.toHaveBeenCalled();
  });

  it('владелец канала есть, а карточки по нему нет — заводим контакт заново', () => {
    const plan = planContact(
      contactOf({ phones: ['+7 999 111-22-33'] }),
      ctxOf(),
      lookupOf({
        channelOwner: ownersOf({
          'phone:+79991112233': { contactId: 'c-404', contactName: 'Пропавший', bitrixId: null },
        }),
        contactById: () => undefined,
      })
    );
    expect(plan).toMatchObject({
      action: 'create',
      data: { channels: [{ value: '+7 999 111-22-33' }] },
    });
  });
});

describe('planContact — организация', () => {
  it.each([
    ['компании в Битриксе не было', null, undefined, null],
    ['компания перенесена — берём организацию ЛК', 'b-co-1', 'org-1', 'org-1'],
    ['компания есть, а организации ЛК нет — контакт без организации', 'b-co-1', undefined, null],
  ] as const)('%s', (_name, companyId, found, expected) => {
    const organizationByBitrixId = vi.fn(() => found);
    const plan = planContact(
      contactOf({ companyId }),
      ctxOf(),
      lookupOf({ organizationByBitrixId })
    );
    expect(plan).toMatchObject({ action: 'create', data: { organizationId: expected } });
    if (companyId) expect(organizationByBitrixId).toHaveBeenCalledWith(companyId);
    else expect(organizationByBitrixId).not.toHaveBeenCalled();
  });
});

describe('planContact — создание целиком', () => {
  it('все поля карточки на месте', () => {
    const plan = planContact(
      contactOf({
        post: '  Директор  ',
        companyId: 'b-co-1',
        phones: ['+7 999 111-22-33'],
        emails: ['Ivan@example.ru'],
      }),
      ctxOf(),
      lookupOf({ organizationByBitrixId: () => 'org-1' })
    );
    expect(plan).toEqual({
      action: 'create',
      data: {
        companyId: COMPANY_ID,
        name: 'Иван Петров',
        position: 'Директор',
        organizationId: 'org-1',
        bitrixId: '42',
        channels: [
          { type: 'phone', value: '+7 999 111-22-33', normalizedValue: '+79991112233' },
          { type: 'email', value: 'Ivan@example.ru', normalizedValue: 'ivan@example.ru' },
        ],
        skippedChannels: [],
      },
    });
  });

  it.each([
    ['должности нет', null, null],
    ['должность из пробелов', '   ', null],
    ['должность указана', 'Директор', 'Директор'],
  ] as const)('%s → %s', (_name, post, expected) => {
    const plan = planContact(contactOf({ post }), ctxOf(), lookupOf());
    expect(plan).toMatchObject({ action: 'create', data: { position: expected } });
  });
});

describe('planContact — обновление найденного контакта', () => {
  it('меняет только отличающееся и запоминает «как было»', () => {
    const plan = planContact(
      contactOf({ post: ' Директор ', companyId: 'b-co-1', phones: ['+7 999 111-22-33'] }),
      ctxOf(),
      lookupOf({
        byBitrixId: () => existingOf({ name: 'Иван П.', position: null, organizationId: null }),
        organizationByBitrixId: () => 'org-1',
      })
    );
    expect(plan).toEqual({
      action: 'update',
      id: 'c-1',
      data: {
        name: 'Иван Петров',
        position: 'Директор',
        organizationId: 'org-1',
        bitrixId: '42',
        channels: [{ type: 'phone', value: '+7 999 111-22-33', normalizedValue: '+79991112233' }],
      },
      before: { name: 'Иван П.', position: null, organizationId: null, bitrixId: null },
    });
  });

  it('ничего не изменилось — нечего писать', () => {
    const plan = planContact(
      contactOf({ post: 'Директор', companyId: 'b-co-1' }),
      ctxOf(),
      lookupOf({
        byBitrixId: () =>
          existingOf({ position: 'Директор', organizationId: 'org-1', bitrixId: '42' }),
        organizationByBitrixId: () => 'org-1',
      })
    );
    expect(plan).toEqual({ action: 'skip', reason: 'no_changes' });
  });

  it('пустые поля Битрикса не затирают заполненные в ЛК', () => {
    const plan = planContact(
      contactOf({ name: '', lastName: '', post: '   ', companyId: null }),
      ctxOf(),
      lookupOf({
        byBitrixId: () =>
          existingOf({
            name: 'Иван Петров',
            position: 'Директор',
            organizationId: 'org-1',
            bitrixId: '42',
          }),
      })
    );
    expect(plan).toEqual({ action: 'skip', reason: 'no_changes' });
  });

  it('bitrixId дописывается только тому, у кого его не было', () => {
    const plan = planContact(
      contactOf(),
      ctxOf(),
      lookupOf({ byBitrixId: () => existingOf({ bitrixId: '999' }) })
    );
    expect(plan).toEqual({ action: 'skip', reason: 'no_changes' });
  });

  it('новый канал дописывается, а уже принадлежащий контакту — нет', () => {
    const plan = planContact(
      contactOf({ phones: ['+7 999 111-22-33', '+7 999 222-33-44'] }),
      ctxOf(),
      lookupOf({
        byBitrixId: () => existingOf({ bitrixId: '42' }),
        channelOwner: ownersOf({
          'phone:+79991112233': { contactId: 'c-1', contactName: 'Иван Петров', bitrixId: '42' },
        }),
      })
    );
    expect(plan).toEqual({
      action: 'update',
      id: 'c-1',
      data: {
        channels: [{ type: 'phone', value: '+7 999 222-33-44', normalizedValue: '+79992223344' }],
      },
      before: {},
    });
  });

  it('занятый чужим контактом канал попадает в план обновления отдельным списком', () => {
    const plan = planContact(
      contactOf({ phones: ['+7 999 111-22-33', '+7 999 222-33-44'] }),
      ctxOf(),
      lookupOf({
        byBitrixId: () => existingOf({ bitrixId: '42' }),
        channelOwner: ownersOf({
          'phone:+79991112233': { contactId: 'c-9', contactName: 'Ольга', bitrixId: '77' },
        }),
      })
    );
    expect(plan).toMatchObject({
      action: 'update',
      data: {
        channels: [{ value: '+7 999 222-33-44' }],
        skippedChannels: [{ value: '+7 999 111-22-33', owner: 'Ольга' }],
      },
    });
  });
});

describe('channelConflicts — строки предпросмотра «канал остался у другого»', () => {
  it('план создания: строка на каждый занятый канал', () => {
    const plan = planContact(
      contactOf({ phones: ['+7 999 111-22-33'], emails: ['ivan@example.ru'] }),
      ctxOf(),
      lookupOf({
        channelOwner: ownersOf({
          'phone:+79991112233': { contactId: 'c-9', contactName: 'Ольга', bitrixId: '77' },
          'email:ivan@example.ru': { contactId: 'c-8', contactName: 'Пётр', bitrixId: '78' },
        }),
      })
    );
    expect(channelConflicts(plan)).toEqual([
      '+7 999 111-22-33 — уже у контакта «Ольга»',
      'ivan@example.ru — уже у контакта «Пётр»',
    ]);
  });

  it('план обновления: те же строки', () => {
    const plan = planContact(
      contactOf({ phones: ['+7 999 111-22-33', '+7 999 222-33-44'] }),
      ctxOf(),
      lookupOf({
        byBitrixId: () => existingOf({ bitrixId: '42' }),
        channelOwner: ownersOf({
          'phone:+79991112233': { contactId: 'c-9', contactName: 'Ольга', bitrixId: '77' },
        }),
      })
    );
    expect(channelConflicts(plan)).toEqual(['+7 999 111-22-33 — уже у контакта «Ольга»']);
  });

  it('в плане обновления списка нет вовсе — пустой массив, а не падение', () => {
    const plan: Plan<ContactData> = {
      action: 'update',
      id: 'c-1',
      data: { name: 'Иван Петров' },
      before: { name: 'Иван П.' },
    };
    expect(channelConflicts(plan)).toEqual([]);
  });

  it('создание без занятых каналов — пусто', () => {
    const plan = planContact(contactOf({ phones: ['+79991112233'] }), ctxOf(), lookupOf());
    expect(channelConflicts(plan)).toEqual([]);
  });

  it.each([
    ['пропуск', { action: 'skip', reason: 'empty' }],
    ['конфликт', { action: 'conflict', reason: 'channel_taken' }],
  ] as const satisfies readonly (readonly [string, Plan<ContactData>])[])(
    'план «%s» конфликтов каналов не показывает',
    (_name, plan) => {
      expect(channelConflicts(plan)).toEqual([]);
    }
  );
});
