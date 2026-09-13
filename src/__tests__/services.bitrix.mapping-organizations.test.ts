import { describe, expect, it, vi } from 'vitest';

import { NO_INN_NOTE, planOrganization } from '@/lib/services/bitrix/mapping/organizations';
import type {
  ExistingOrganization,
  OrganizationLookup,
} from '@/lib/services/bitrix/mapping/organizations';
import type { MappingContext } from '@/lib/services/bitrix/mapping/types';
import type { BitrixCompany } from '@/lib/services/bitrix/source';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-191`, спека §3.3): компания Битрикса → организация ЛК.
 *
 * Порядок поиска жёсткий: `bitrixId` → ИНН → нормализованное название своей
 * компании → создать. ИНН уникален глобально, поэтому тёзка в чужой компании —
 * конфликт, а не «обновим».
 *
 * ИНН ниже — настоящие, проходящие контрольную сумму ФНС
 * (`src/lib/services/oneCSync/inn.ts`): `7707083893` — юрлицо,
 * `500100732259` — физлицо/ИП, `0123456788` — юрлицо с ведущим нулём, который
 * Excel часто теряет.
 */

const COMPANY_ID = 'co-1';
const VALID_INN = '7707083893';
const VALID_INN_12 = '500100732259';
const VALID_INN_ZERO = '0123456788';
const INVALID_INN = '1234567890';
/** Неразрывный пробел U+00A0: выгрузки вставляют его внутрь чисел, глазом не видно. */
const NBSP = String.fromCharCode(0x00a0);

const ctxOf = (over: Partial<MappingContext> = {}): MappingContext => ({
  companyId: COMPANY_ID,
  importerId: 'u-importer',
  defaultManagerId: 'u-manager',
  tables: { stageMap: {}, leadStageMap: {}, taskColumnMap: {}, userMap: {} },
  resolveUser: () => null,
  ...over,
});

const companyOf = (over: Partial<BitrixCompany> = {}): BitrixCompany => ({
  id: '7',
  title: 'ООО «Ромашка»',
  inn: null,
  kpp: null,
  assignedById: null,
  createdAt: null,
  comments: null,
  ...over,
});

const existingOf = (over: Partial<ExistingOrganization> = {}): ExistingOrganization => ({
  id: 'org-1',
  companyId: COMPANY_ID,
  name: 'ООО «Ромашка»',
  inn: null,
  kpp: null,
  bitrixId: null,
  ...over,
});

const lookupOf = (over: Partial<OrganizationLookup> = {}): OrganizationLookup => ({
  byBitrixId: () => undefined,
  byInn: () => undefined,
  byNameKey: () => undefined,
  ...over,
});

describe('planOrganization — ничего не нашли, заводим организацию', () => {
  it('создание со всеми полями карточки', () => {
    const plan = planOrganization(
      companyOf({ inn: VALID_INN, kpp: '770301001', assignedById: 'b-5' }),
      ctxOf({ resolveUser: () => 'u-ivan' }),
      lookupOf()
    );
    expect(plan).toEqual({
      action: 'create',
      data: {
        name: 'ООО «Ромашка»',
        nameKey: 'РОМАШКА',
        inn: VALID_INN,
        kpp: '770301001',
        companyId: COMPANY_ID,
        bitrixId: '7',
        managerUserId: 'u-ivan',
        note: null,
      },
    });
  });

  it('без ИНН карточка получает пометку, а не пустоту', () => {
    expect(NO_INN_NOTE).toBe('ИНН не указан в Битрикс24');
    const plan = planOrganization(companyOf(), ctxOf(), lookupOf());
    expect(plan).toMatchObject({ action: 'create', data: { inn: null, note: NO_INN_NOTE } });
  });

  it.each([
    ['как есть', VALID_INN, VALID_INN],
    ['с пробелами внутри и по краям', '  7707 083893 ', VALID_INN],
    ['с неразрывным пробелом из выгрузки', `7707${NBSP}083893`, VALID_INN],
    ['потерянный Excel-ем ведущий ноль восстанавливается', '123456788', VALID_INN_ZERO],
    ['двенадцать знаков (ИП)', VALID_INN_12, VALID_INN_12],
  ] as const)('ИНН нормализуется: %s', (_name, raw, expected) => {
    const plan = planOrganization(companyOf({ inn: raw }), ctxOf(), lookupOf());
    expect(plan).toMatchObject({ action: 'create', data: { inn: expected, note: null } });
  });

  it.each([
    ['битая контрольная сумма', INVALID_INN],
    ['девять знаков', '770708389'],
    ['буквы', 'нет ИНН'],
    ['пустая строка', ''],
  ] as const)('невалидный ИНН (%s) не сохраняется и не ищется', (_name, raw) => {
    const byInn = vi.fn(() => undefined);
    const plan = planOrganization(companyOf({ inn: raw }), ctxOf(), lookupOf({ byInn }));
    expect(plan).toMatchObject({ action: 'create', data: { inn: null, note: NO_INN_NOTE } });
    expect(byInn).not.toHaveBeenCalled();
  });

  it.each([
    ['название пустое', '', 'Компания Битрикс24 #7'],
    ['название из одних пробелов', '   ', 'Компания Битрикс24 #7'],
    ['название с лишними пробелами обрезается', '  ООО «Ромашка»  ', 'ООО «Ромашка»'],
  ] as const)('%s → «%s»', (_name, title, expected) => {
    const plan = planOrganization(companyOf({ title }), ctxOf(), lookupOf());
    expect(plan).toMatchObject({ action: 'create', data: { name: expected } });
  });

  it('название из одной орг-формы не даёт ключа — по названию не ищем', () => {
    const byNameKey = vi.fn(() => undefined);
    const plan = planOrganization(companyOf({ title: 'ООО' }), ctxOf(), lookupOf({ byNameKey }));
    expect(plan).toMatchObject({ action: 'create', data: { name: 'ООО', nameKey: null } });
    expect(byNameKey).not.toHaveBeenCalled();
  });

  it.each([
    ['сопоставленный ответственный', 'u-ivan', 'u-manager', 'u-ivan'],
    ['не сопоставлен — менеджер по умолчанию', null, 'u-manager', 'u-manager'],
    ['не сопоставлен и менеджера нет — организация без ответственного', null, null, null],
  ] as const)('%s', (_name, resolved, defaultManagerId, expected) => {
    const plan = planOrganization(
      companyOf({ assignedById: 'b-5' }),
      ctxOf({ resolveUser: () => resolved, defaultManagerId }),
      lookupOf()
    );
    expect(plan).toMatchObject({ action: 'create', data: { managerUserId: expected } });
  });

  it('ответственного спрашивают по идентификатору из Битрикса', () => {
    const resolveUser = vi.fn(() => null);
    planOrganization(companyOf({ assignedById: 'b-5' }), ctxOf({ resolveUser }), lookupOf());
    expect(resolveUser).toHaveBeenCalledWith('b-5');
  });
});

describe('planOrganization — порядок поиска существующей', () => {
  it('по bitrixId: ИНН и название уже не спрашиваем', () => {
    const byInn = vi.fn(() => undefined);
    const byNameKey = vi.fn(() => undefined);
    const plan = planOrganization(
      companyOf({ inn: VALID_INN, title: 'Новое имя' }),
      ctxOf(),
      lookupOf({ byBitrixId: () => existingOf({ bitrixId: '7' }), byInn, byNameKey })
    );
    expect(plan).toMatchObject({ action: 'update', id: 'org-1' });
    expect(byInn).not.toHaveBeenCalled();
    expect(byNameKey).not.toHaveBeenCalled();
  });

  it('по ИНН, когда по bitrixId не нашлось', () => {
    const byInn = vi.fn(() => existingOf({ id: 'org-inn', inn: VALID_INN }));
    const byNameKey = vi.fn(() => undefined);
    const plan = planOrganization(
      companyOf({ inn: ` ${VALID_INN} `, title: 'Ромашка' }),
      ctxOf(),
      lookupOf({ byInn, byNameKey })
    );
    // Ищем НОРМАЛИЗОВАННЫМ ИНН — иначе пробелы из выгрузки не дали бы совпадения.
    expect(byInn).toHaveBeenCalledWith(VALID_INN);
    expect(byNameKey).not.toHaveBeenCalled();
    expect(plan).toMatchObject({ action: 'update', id: 'org-inn' });
  });

  it('по названию, когда ни bitrixId, ни ИНН не нашли', () => {
    const byNameKey = vi.fn(() => existingOf({ id: 'org-name', name: 'Ромашка' }));
    const plan = planOrganization(companyOf({ inn: VALID_INN }), ctxOf(), lookupOf({ byNameKey }));
    expect(byNameKey).toHaveBeenCalledWith('РОМАШКА');
    expect(plan).toMatchObject({ action: 'update', id: 'org-name' });
  });

  it('ИНН не дали — ищем сразу по названию', () => {
    const byInn = vi.fn(() => undefined);
    const byNameKey = vi.fn(() => undefined);
    planOrganization(companyOf({ inn: null }), ctxOf(), lookupOf({ byInn, byNameKey }));
    expect(byInn).not.toHaveBeenCalled();
    expect(byNameKey).toHaveBeenCalledWith('РОМАШКА');
  });
});

describe('planOrganization — тёзка в чужой компании', () => {
  it('организация найдена в ЧУЖОЙ компании → конфликт с подсказкой-именем', () => {
    const plan = planOrganization(
      companyOf({ inn: VALID_INN }),
      ctxOf(),
      lookupOf({
        byInn: () => existingOf({ companyId: 'co-other', name: 'ООО «Ромашка»' }),
      })
    );
    expect(plan).toEqual({
      action: 'conflict',
      reason: 'inn_other_company',
      hint: '«ООО «Ромашка»» уже заведена в другой компании',
    });
  });

  it('конфликт срабатывает и при находке по bitrixId, не только по ИНН', () => {
    const plan = planOrganization(
      companyOf(),
      ctxOf(),
      lookupOf({ byBitrixId: () => existingOf({ companyId: 'co-other', name: 'Чужая' }) })
    );
    expect(plan).toMatchObject({
      action: 'conflict',
      reason: 'inn_other_company',
      hint: '«Чужая» уже заведена в другой компании',
    });
  });

  it('организация без компании (ничейная) — не конфликт, обновляем', () => {
    const plan = planOrganization(
      companyOf({ inn: VALID_INN }),
      ctxOf(),
      lookupOf({ byInn: () => existingOf({ companyId: null, name: 'ООО «Ромашка»' }) })
    );
    expect(plan).toMatchObject({ action: 'update', id: 'org-1' });
  });

  it('своя компания — не конфликт', () => {
    const plan = planOrganization(
      companyOf({ inn: VALID_INN }),
      ctxOf(),
      lookupOf({ byInn: () => existingOf({ companyId: COMPANY_ID, inn: VALID_INN }) })
    );
    expect(plan).toMatchObject({ action: 'update' });
  });
});

describe('planOrganization — обновление существующей', () => {
  it('меняет только то, что отличается, и запоминает «как было»', () => {
    const plan = planOrganization(
      companyOf({ title: 'ООО «Ромашка-2»', inn: VALID_INN, kpp: '773301001' }),
      ctxOf(),
      lookupOf({
        byBitrixId: () => existingOf({ name: 'Ромашка', inn: null, kpp: null, bitrixId: '7' }),
      })
    );
    expect(plan).toEqual({
      action: 'update',
      id: 'org-1',
      data: {
        name: 'ООО «Ромашка-2»',
        nameKey: 'РОМАШКА 2',
        inn: VALID_INN,
        kpp: '773301001',
      },
      before: { name: 'Ромашка', inn: null, kpp: null },
    });
  });

  it('снимок «как было» несёт только изменяемые поля — по нему делается откат', () => {
    const plan = planOrganization(
      companyOf({ title: 'Новое имя', inn: VALID_INN }),
      ctxOf(),
      lookupOf({
        byBitrixId: () =>
          existingOf({ name: 'Старое имя', inn: VALID_INN, kpp: '770301001', bitrixId: '7' }),
      })
    );
    expect(plan).toMatchObject({ action: 'update' });
    if (plan.action !== 'update') throw new Error('ожидалось обновление');
    // КПП и ИНН не менялись — их в снимке нет вовсе, а не `null`.
    expect(Object.keys(plan.before)).toEqual(['name']);
    expect(plan.before).toEqual({ name: 'Старое имя' });
  });

  it.each([
    ['ИНН', { inn: null }, { inn: VALID_INN }],
    ['КПП', { kpp: null }, { kpp: '770301001' }],
    ['КПП из одних пробелов', { kpp: '   ' }, { kpp: '770301001' }],
  ] as const)('пустой %s из Битрикса не затирает заполненный в ЛК', (_name, fromBitrix, inLk) => {
    const plan = planOrganization(
      companyOf({ ...fromBitrix }),
      ctxOf(),
      lookupOf({ byBitrixId: () => existingOf({ ...inLk, bitrixId: '7' }) })
    );
    expect(plan).toEqual({ action: 'skip', reason: 'no_changes', id: 'org-1' });
  });

  it('bitrixId дописывается, только если его не было', () => {
    const fresh = planOrganization(
      companyOf({ inn: VALID_INN }),
      ctxOf(),
      lookupOf({ byInn: () => existingOf({ inn: VALID_INN, bitrixId: null }) })
    );
    expect(fresh).toEqual({
      action: 'update',
      id: 'org-1',
      data: { bitrixId: '7' },
      before: { bitrixId: null },
    });

    const already = planOrganization(
      companyOf({ inn: VALID_INN }),
      ctxOf(),
      lookupOf({ byInn: () => existingOf({ inn: VALID_INN, bitrixId: '7' }) })
    );
    expect(already).toEqual({ action: 'skip', reason: 'no_changes', id: 'org-1' });
  });

  it('у найденной организации ЧУЖОЙ bitrixId — поле не трогаем', () => {
    // Поле заполнено, значит переносили раньше: миграция его не трогает.
    const plan = planOrganization(
      companyOf({ inn: VALID_INN }),
      ctxOf(),
      lookupOf({ byInn: () => existingOf({ inn: VALID_INN, bitrixId: '999' }) })
    );
    expect(plan).toEqual({ action: 'skip', reason: 'no_changes', id: 'org-1' });
  });

  it('всё совпало — нечего менять', () => {
    const plan = planOrganization(
      companyOf({ inn: VALID_INN, kpp: '770301001' }),
      ctxOf(),
      lookupOf({
        byBitrixId: () =>
          existingOf({
            name: 'ООО «Ромашка»',
            inn: VALID_INN,
            kpp: '770301001',
            bitrixId: '7',
          }),
      })
    );
    expect(plan).toEqual({ action: 'skip', reason: 'no_changes', id: 'org-1' });
  });

  it('название обновляется вместе с ключом поиска', () => {
    const plan = planOrganization(
      companyOf({ title: 'ООО «Василёк»' }),
      ctxOf(),
      lookupOf({ byBitrixId: () => existingOf({ name: 'ООО «Ромашка»', bitrixId: '7' }) })
    );
    expect(plan).toMatchObject({
      action: 'update',
      data: { name: 'ООО «Василёк»', nameKey: 'ВАСИЛЕК' },
    });
  });

  it('пустое название из Битрикса не затирает имя в кабинете', () => {
    // Заглушка «Компания Битрикс24 #id» нужна только новой организации: в
    // обновлении она затёрла бы живое имя, нарушив правило «пустое не затирает».
    const plan = planOrganization(
      companyOf({ title: '   ', inn: VALID_INN }),
      ctxOf(),
      lookupOf({
        byInn: () => existingOf({ name: 'ООО «Ромашка»', inn: VALID_INN, bitrixId: '7' }),
      })
    );
    expect(plan).toEqual({ action: 'skip', reason: 'no_changes', id: 'org-1' });
  });

  it('название изменилось — пишется вместе с ключом поиска', () => {
    const plan = planOrganization(
      companyOf({ title: 'ООО «Ромашка Плюс»', inn: VALID_INN }),
      ctxOf(),
      lookupOf({
        byInn: () => existingOf({ name: 'ООО «Ромашка»', inn: VALID_INN, bitrixId: '7' }),
      })
    );
    expect(plan).toMatchObject({
      action: 'update',
      data: { name: 'ООО «Ромашка Плюс»' },
      before: { name: 'ООО «Ромашка»' },
    });
  });
});
