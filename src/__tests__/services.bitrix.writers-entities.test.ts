import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApplyContext, Tx } from '@/lib/services/bitrix/writers/journal';
import type { FieldMap } from '@/lib/services/bitrix/idempotency';
import type { BitrixEntity, Plan } from '@/lib/services/bitrix/mapping/types';
import type { ContactData } from '@/lib/services/bitrix/mapping/contacts';
import type { DealData } from '@/lib/services/bitrix/mapping/deals';
import type { LeadData } from '@/lib/services/bitrix/mapping/leads';
import type { OrganizationData } from '@/lib/services/bitrix/mapping/organizations';
import type { TaskData } from '@/lib/services/bitrix/mapping/tasks';
import type { DealNoteData, OrganizationNoteData } from '@/lib/services/bitrix/mapping/notes';
import {
  writeContact,
  writeDeal,
  writeDealNote,
  writeLead,
  writeOrganization,
  writeOrganizationNote,
  writeTask,
} from '@/lib/services/bitrix/writers/entities';

/**
 * Писатели сущностей пакета (`У-194`, спека §3.2).
 *
 * Проверяется то, ради чего модуль написан: строка и её журнал пишутся В ОДНОЙ
 * транзакции (журнал — единственный способ откатить перенос), связи, которые
 * штатные сервисы завели бы сами, заводятся здесь руками (менеджер организации,
 * каналы контакта, исполнители задачи, лид → сделка), а обновление идёт через
 * правило §3.4: правленное человеком остаётся человеку. Транзакция — объект с
 * нужными методами: живой Postgres здесь не нужен и увёл бы файл в
 * integration-слой.
 */
const organizationCreate = vi.fn();
const organizationUpdate = vi.fn();
const organizationNoteCreate = vi.fn();
const organizationManagerCreate = vi.fn();
const contactCreate = vi.fn();
const contactUpdate = vi.fn();
const contactChannelCreateMany = vi.fn();
const leadCreate = vi.fn();
const leadUpdate = vi.fn();
const leadUpdateMany = vi.fn();
const dealCreate = vi.fn();
const dealUpdate = vi.fn();
const dealNoteCreate = vi.fn();
const taskCreate = vi.fn();
const taskUpdate = vi.fn();
const journalCreate = vi.fn();

const tx = {
  organization: { create: organizationCreate, update: organizationUpdate },
  organizationNote: { create: organizationNoteCreate },
  organizationManager: { create: organizationManagerCreate },
  contact: { create: contactCreate, update: contactUpdate },
  contactChannel: { createMany: contactChannelCreateMany },
  lead: { create: leadCreate, update: leadUpdate, updateMany: leadUpdateMany },
  deal: { create: dealCreate, update: dealUpdate },
  dealNote: { create: dealNoteCreate },
  task: { create: taskCreate, update: taskUpdate },
  bitrixImportWrite: { create: journalCreate },
} as unknown as Tx;

/** `after` прошлого прогона — подменяется в тестах правила «правленное руками». */
let lastAfter: FieldMap | null = null;
const lastAfterCalls: Array<[BitrixEntity, string]> = [];

const ctx: ApplyContext = {
  batchId: 'b1',
  companyId: 'c1',
  importerId: 'u-importer',
  defaultManagerId: 'm1',
  lastAfter: (entity, entityId) => {
    lastAfterCalls.push([entity, entityId]);
    return lastAfter;
  },
};

/** Планы, при которых писатель обязан молчать. */
const SILENT_PLANS: Plan<never>[] = [
  { action: 'skip', reason: 'no_changes', id: 'x1' },
  { action: 'conflict', reason: 'stage_not_mapped', hint: 'C1:NEW' },
];

const journalData = (): Record<string, unknown> => journalCreate.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  lastAfter = null;
  lastAfterCalls.length = 0;
  organizationCreate.mockResolvedValue({ id: 'o1' });
  contactCreate.mockResolvedValue({ id: 'k1' });
  leadCreate.mockResolvedValue({ id: 'l1' });
  dealCreate.mockResolvedValue({ id: 'd1' });
  dealNoteCreate.mockResolvedValue({ id: 'n1' });
  organizationNoteCreate.mockResolvedValue({ id: 'n2' });
  taskCreate.mockResolvedValue({ id: 't1' });
  for (const fn of [
    organizationUpdate,
    organizationManagerCreate,
    contactUpdate,
    contactChannelCreateMany,
    leadUpdate,
    leadUpdateMany,
    dealUpdate,
    taskUpdate,
    journalCreate,
  ]) {
    fn.mockResolvedValue({});
  }
});

const orgData = (over: Partial<OrganizationData> = {}): OrganizationData => ({
  name: 'ООО «Альфа»',
  nameKey: 'АЛЬФА',
  inn: '7701234560',
  kpp: '770101001',
  companyId: 'c1',
  bitrixId: '101',
  managerUserId: null,
  note: null,
  ...over,
});

describe('writeOrganization — создание', () => {
  it('пишет строку и журнал в одной транзакции', async () => {
    const out = await writeOrganization(tx, ctx, { action: 'create', data: orgData() }, '101');

    expect(organizationCreate).toHaveBeenCalledWith({
      data: {
        name: 'ООО «Альфа»',
        nameKey: 'АЛЬФА',
        inn: '7701234560',
        kpp: '770101001',
        companyId: 'c1',
        bitrixId: '101',
      },
      select: { id: true },
    });
    expect(journalCreate).toHaveBeenCalledTimes(1);
    expect(journalData()).toEqual({
      batchId: 'b1',
      entity: 'organization',
      entityId: 'o1',
      bitrixId: '101',
      action: 'created',
      after: { name: 'ООО «Альфа»', inn: '7701234560', kpp: '770101001', bitrixId: '101' },
    });
    expect(out).toEqual({ entityId: 'o1', action: 'created', keptManual: [] });
  });

  it('организация без ИНН получает заметку с пометкой', async () => {
    await writeOrganization(
      tx,
      ctx,
      {
        action: 'create',
        data: orgData({ inn: null, kpp: null, note: 'В Битрикс24 не был указан ИНН' }),
      },
      '101'
    );

    expect(organizationNoteCreate).toHaveBeenCalledWith({
      data: {
        companyId: 'c1',
        organizationId: 'o1',
        body: 'В Битрикс24 не был указан ИНН',
        authorId: null,
      },
      select: { id: true },
    });
    // Пометка — такая же запись переноса, как сама организация: без строки
    // журнала откат о ней не узнал бы, и она пережила бы возврат.
    expect(journalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entity: 'note', action: 'created' }),
      })
    );
  });

  it('организация с ИНН заметку не получает', async () => {
    await writeOrganization(tx, ctx, { action: 'create', data: orgData() }, '101');

    expect(organizationNoteCreate).not.toHaveBeenCalled();
  });

  it('ответственный из Битрикса становится менеджером организации', async () => {
    await writeOrganization(
      tx,
      ctx,
      { action: 'create', data: orgData({ managerUserId: 'm-77' }) },
      '101'
    );

    expect(organizationManagerCreate).toHaveBeenCalledWith({
      data: { organizationId: 'o1', userId: 'm-77' },
    });
  });

  it('без ответственного связь менеджера не заводится', async () => {
    await writeOrganization(tx, ctx, { action: 'create', data: orgData() }, '101');

    expect(organizationManagerCreate).not.toHaveBeenCalled();
  });
});

describe('writeOrganization — обновление', () => {
  it('имя пишется вместе с пересчитанным `nameKey`', async () => {
    const plan: Plan<OrganizationData> = {
      action: 'update',
      id: 'o1',
      data: { name: 'ООО «Бета»', kpp: '770101002' },
      before: { name: 'ООО «Альфа»', kpp: null },
    };

    const out = await writeOrganization(tx, ctx, plan, '101');

    expect(lastAfterCalls).toEqual([['organization', 'o1']]);
    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { name: 'ООО «Бета»', kpp: '770101002', nameKey: 'БЕТА' },
    });
    expect(journalData()).toMatchObject({
      entity: 'organization',
      entityId: 'o1',
      action: 'updated',
      before: { name: 'ООО «Альфа»', kpp: null },
      after: { name: 'ООО «Бета»', kpp: '770101002' },
    });
    expect(out).toEqual({ entityId: 'o1', action: 'updated', keptManual: [] });
  });

  it('`nameKey` попадает в снимок вместе с названием — откат вернёт и ключ поиска', async () => {
    // `planOrganization` кладёт `nameKey` в патч, но в снимок «как было» его не
    // кладёт. `mergeUpdate` берёт старое значение из `plan.before`, там ключа
    // нет, и в журнал уезжает `before.nameKey = null`. Откат по такому снимку
    // обнулит `nameKey` организации, у которой он был, — по названию её больше
    // не найдут.
    await writeOrganization(
      tx,
      ctx,
      {
        action: 'update',
        id: 'o1',
        data: { name: 'ООО «Бета»', nameKey: 'БЕТА' },
        before: { name: 'ООО «Альфа»' },
      },
      '101'
    );

    expect(journalData()).toMatchObject({
      before: { name: 'ООО «Альфа»', nameKey: null },
      after: { name: 'ООО «Бета»', nameKey: 'БЕТА' },
    });
  });

  it('без имени в патче `nameKey` не трогается', async () => {
    await writeOrganization(
      tx,
      ctx,
      { action: 'update', id: 'o1', data: { kpp: '770101002' }, before: { kpp: null } },
      '101'
    );

    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { kpp: '770101002' },
    });
  });

  it('всё правлено руками — ни строки, ни журнала, но человек узнает из отчёта', async () => {
    lastAfter = { name: 'ООО «Альфа из Битрикса»' };

    const out = await writeOrganization(
      tx,
      ctx,
      {
        action: 'update',
        id: 'o1',
        data: { name: 'ООО «Бета»' },
        before: { name: 'ООО «Альфа» (правил менеджер)' },
      },
      '101'
    );

    expect(organizationUpdate).not.toHaveBeenCalled();
    expect(journalCreate).not.toHaveBeenCalled();
    expect(out).toEqual({ entityId: 'o1', action: 'updated', keptManual: ['name'] });
  });

  it('менять нечего — ни записи, ни журнала, ни строки в отчёте', async () => {
    const out = await writeOrganization(
      tx,
      ctx,
      {
        action: 'update',
        id: 'o1',
        data: { name: 'ООО «Альфа»' },
        before: { name: 'ООО «Альфа»' },
      },
      '101'
    );

    expect(organizationUpdate).not.toHaveBeenCalled();
    expect(journalCreate).not.toHaveBeenCalled();
    expect(out).toBeNull();
  });
});

describe('writeOrganization — планы без записи', () => {
  it.each(SILENT_PLANS)('план `$action` ничего не пишет', async (plan) => {
    const out = await writeOrganization(tx, ctx, plan as Plan<OrganizationData>, '101');

    expect(out).toBeNull();
    expect(organizationCreate).not.toHaveBeenCalled();
    expect(organizationUpdate).not.toHaveBeenCalled();
    expect(journalCreate).not.toHaveBeenCalled();
  });
});

const CHANNELS: ContactData['channels'] = [
  { type: 'phone', value: '+7 (921) 111-22-33', normalizedValue: '+79211112233' },
  { type: 'email', value: 'ivan@alfa.ru', normalizedValue: 'ivan@alfa.ru' },
];

describe('writeContact', () => {
  it('создаёт контакт вместе с каналами, первый канал — основной', async () => {
    const out = await writeContact(
      tx,
      ctx,
      {
        action: 'create',
        data: {
          companyId: 'c1',
          name: 'Иван Иванов',
          position: 'Директор',
          organizationId: 'o1',
          bitrixId: '301',
          channels: CHANNELS,
          skippedChannels: [],
        },
      },
      '301'
    );

    expect(contactCreate).toHaveBeenCalledWith({
      data: {
        companyId: 'c1',
        organizationId: 'o1',
        name: 'Иван Иванов',
        position: 'Директор',
        bitrixId: '301',
        createdById: 'u-importer',
        channels: {
          create: [
            {
              companyId: 'c1',
              type: 'phone',
              value: '+7 (921) 111-22-33',
              normalizedValue: '+79211112233',
              isPrimary: true,
            },
            {
              companyId: 'c1',
              type: 'email',
              value: 'ivan@alfa.ru',
              normalizedValue: 'ivan@alfa.ru',
              isPrimary: false,
            },
          ],
        },
      },
      select: { id: true },
    });
    expect(journalData()).toMatchObject({
      entity: 'contact',
      entityId: 'k1',
      action: 'created',
      after: { name: 'Иван Иванов', position: 'Директор', organizationId: 'o1' },
    });
    expect(out).toEqual({ entityId: 'k1', action: 'created', keptManual: [] });
  });

  it('при обновлении каналы дописываются отдельно и из патча карточки убираются', async () => {
    const plan: Plan<ContactData> = {
      action: 'update',
      id: 'k1',
      data: {
        name: 'Иван Петров',
        channels: [CHANNELS[0]],
        skippedChannels: [{ value: 'ivan@alfa.ru', owner: 'Пётр Сидоров' }],
      },
      before: { name: 'Иван Иванов' },
    };

    const out = await writeContact(tx, ctx, plan, '301');

    expect(contactUpdate).toHaveBeenCalledWith({
      where: { id: 'k1' },
      data: { name: 'Иван Петров' },
    });
    expect(contactChannelCreateMany).toHaveBeenCalledTimes(1);
    expect(contactChannelCreateMany).toHaveBeenCalledWith({
      data: [
        {
          contactId: 'k1',
          companyId: 'c1',
          type: 'phone',
          value: '+7 (921) 111-22-33',
          normalizedValue: '+79211112233',
        },
      ],
      skipDuplicates: true,
    });
    expect(out).toEqual({ entityId: 'k1', action: 'updated', keptManual: [] });
  });

  it('служебные `channels`/`skippedChannels` в журнал не попадают', async () => {
    // Поля-помощники плана — не колонки таблицы: попади они в снимок, откат
    // попытался бы выставить контакту `channels: null` и упал бы.
    await writeContact(
      tx,
      ctx,
      {
        action: 'update',
        id: 'k1',
        data: {
          name: 'Иван Петров',
          channels: [CHANNELS[0]],
          skippedChannels: [{ value: 'ivan@alfa.ru', owner: 'Пётр Сидоров' }],
        },
        before: { name: 'Иван Иванов' },
      },
      '301'
    );

    const data = journalData();
    expect(data.before).not.toHaveProperty('channels');
    expect(data.before).not.toHaveProperty('skippedChannels');
    expect(data.after).not.toHaveProperty('channels');
    expect(data.after).not.toHaveProperty('skippedChannels');
    // Имя при этом записано как обычное поле.
    expect(data.after).toMatchObject({ name: 'Иван Петров' });
  });

  it('в патче только каналы — строку контакта не трогаем, каналы дописываем', async () => {
    await writeContact(
      tx,
      ctx,
      { action: 'update', id: 'k1', data: { channels: CHANNELS }, before: {} },
      '301'
    );

    expect(contactUpdate).not.toHaveBeenCalled();
    expect(contactChannelCreateMany).toHaveBeenCalledTimes(2);
  });

  it('на втором прогоне каналы дописываются молча — отчёт не говорит про «ручное»', async () => {
    // Каналы живут мимо правила §3.4 (это способ найти человека, а не поле
    // карточки), поэтому прошлый снимок не должен превращать их в «правленое
    // руками»: иначе человек читал бы про правку, которой не было.
    lastAfter = { channels: [CHANNELS[0]] } as unknown as FieldMap;

    const out = await writeContact(
      tx,
      ctx,
      { action: 'update', id: 'k1', data: { channels: [CHANNELS[0]] }, before: {} },
      '301'
    );

    expect(contactChannelCreateMany).toHaveBeenCalledTimes(1);
    expect(contactUpdate).not.toHaveBeenCalled();
    expect(journalCreate).not.toHaveBeenCalled();
    expect(out).toEqual({ entityId: 'k1', action: 'updated', keptManual: [] });
  });

  it('патч без каналов — `createMany` не зовём вовсе', async () => {
    await writeContact(
      tx,
      ctx,
      {
        action: 'update',
        id: 'k1',
        data: { position: 'Главный инженер' },
        before: { position: null },
      },
      '301'
    );

    expect(contactChannelCreateMany).not.toHaveBeenCalled();
    expect(contactUpdate).toHaveBeenCalledWith({
      where: { id: 'k1' },
      data: { position: 'Главный инженер' },
    });
  });

  it('обновление без единой правки честно отвечает «ничего не делали»', async () => {
    // Сводка не должна считать обновление, которого не произошло: ни строки,
    // ни журнала здесь нет, и откатывать тоже нечего.
    const out = await writeContact(
      tx,
      ctx,
      {
        action: 'update',
        id: 'k1',
        data: { name: 'Иван Иванов' },
        before: { name: 'Иван Иванов' },
      },
      '301'
    );

    expect(contactUpdate).not.toHaveBeenCalled();
    expect(journalCreate).not.toHaveBeenCalled();
    expect(out).toBeNull();
  });

  it.each(SILENT_PLANS)('план `$action` ничего не пишет', async (plan) => {
    const out = await writeContact(tx, ctx, plan as Plan<ContactData>, '301');

    expect(out).toBeNull();
    expect(contactCreate).not.toHaveBeenCalled();
    expect(contactChannelCreateMany).not.toHaveBeenCalled();
    expect(journalCreate).not.toHaveBeenCalled();
  });
});

const leadData = (over: Partial<LeadData> = {}): LeadData => ({
  source: 'manual',
  status: 'new',
  funnelStageId: 'fs-1',
  subject: 'Лид из Битрикс24',
  clientCompanyName: 'ООО «Альфа»',
  clientContactName: 'Иван Иванов',
  clientContactPhone: '+79211112233',
  clientContactEmail: 'ivan@alfa.ru',
  clientInn: '7701234560',
  estimatedAmount: null,
  organizationId: 'o1',
  assignedManagerId: 'm1',
  createdByUserId: 'u-importer',
  notes: null,
  bitrixId: '201',
  ...over,
});

describe('writeLead', () => {
  it('создаёт лид и журнал; сумма без значения в запись не попадает', async () => {
    const out = await writeLead(tx, ctx, { action: 'create', data: leadData() }, '201');

    expect(leadCreate.mock.calls[0][0].data).not.toHaveProperty('estimatedAmount');
    expect(leadCreate.mock.calls[0][0]).toMatchObject({
      data: { subject: 'Лид из Битрикс24', funnelStageId: 'fs-1', bitrixId: '201' },
      select: { id: true },
    });
    expect(journalData()).toMatchObject({
      entity: 'lead',
      entityId: 'l1',
      action: 'created',
      after: { subject: 'Лид из Битрикс24', status: 'new', funnelStageId: 'fs-1' },
    });
    expect(out).toEqual({ entityId: 'l1', action: 'created', keptManual: [] });
  });

  it('сумма из Битрикса переносится, когда она есть', async () => {
    await writeLead(
      tx,
      ctx,
      { action: 'create', data: leadData({ estimatedAmount: '150000' }) },
      '201'
    );

    expect(leadCreate.mock.calls[0][0].data).toMatchObject({ estimatedAmount: '150000' });
  });

  it('обновление идёт через правило §3.4', async () => {
    const out = await writeLead(
      tx,
      ctx,
      {
        action: 'update',
        id: 'l1',
        data: { status: 'qualified', funnelStageId: 'fs-2' },
        before: { status: 'new', funnelStageId: 'fs-1' },
      },
      '201'
    );

    expect(leadUpdate).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { status: 'qualified', funnelStageId: 'fs-2' },
    });
    expect(out).toEqual({ entityId: 'l1', action: 'updated', keptManual: [] });
  });

  it.each(SILENT_PLANS)('план `$action` ничего не пишет', async (plan) => {
    const out = await writeLead(tx, ctx, plan as Plan<LeadData>, '201');

    expect(out).toBeNull();
    expect(leadCreate).not.toHaveBeenCalled();
    expect(journalCreate).not.toHaveBeenCalled();
  });
});

const dealData = (over: Partial<DealData> = {}): DealData => ({
  companyId: 'c1',
  title: 'Сделка из Битрикс24',
  amount: null,
  status: 'open',
  stageId: 'ds-1',
  organizationId: 'o1',
  contactId: 'k1',
  leadId: null,
  managerId: 'm1',
  expectedCloseAt: null,
  wonAt: null,
  lostAt: null,
  bitrixId: '501',
  wantsOrder: false,
  ...over,
});

describe('writeDeal', () => {
  it('создаёт сделку и журнал; пустая сумма в запись не попадает', async () => {
    const out = await writeDeal(tx, ctx, { action: 'create', data: dealData() }, '501');

    expect(dealCreate.mock.calls[0][0].data).not.toHaveProperty('amount');
    expect(dealCreate.mock.calls[0][0].data).toMatchObject({
      companyId: 'c1',
      title: 'Сделка из Битрикс24',
      stageId: 'ds-1',
      bitrixId: '501',
    });
    expect(leadUpdateMany).not.toHaveBeenCalled();
    expect(journalData()).toMatchObject({
      entity: 'deal',
      entityId: 'd1',
      action: 'created',
      after: { title: 'Сделка из Битрикс24', status: 'open', stageId: 'ds-1', wonAt: null },
    });
    expect(out).toEqual({ entityId: 'd1', action: 'created', keptManual: [] });
  });

  it('сделка из лида проставляет лиду `promotedDealId`, не перебивая живую связь', async () => {
    await writeDeal(
      tx,
      ctx,
      {
        action: 'create',
        data: dealData({ leadId: 'l1', amount: '150000', wonAt: new Date('2026-01-01T10:00:00Z') }),
      },
      '501'
    );

    expect(dealCreate.mock.calls[0][0].data).toMatchObject({ amount: '150000' });
    expect(leadUpdateMany).toHaveBeenCalledWith({
      where: { id: 'l1', promotedDealId: null },
      data: { promotedDealId: 'd1' },
    });
    expect(journalData()).toMatchObject({ after: { wonAt: '2026-01-01T10:00:00.000Z' } });
  });

  it('служебный `wantsOrder` из патча убирается — колонки с таким именем нет', async () => {
    await writeDeal(
      tx,
      ctx,
      {
        action: 'update',
        id: 'd1',
        data: { title: 'Новое название', wantsOrder: true },
        before: { title: 'Старое название' },
      },
      '501'
    );

    expect(dealUpdate).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { title: 'Новое название' },
    });
    // И в журнал он не попадает: снимок отката не должен нести поле, которого
    // нет в таблице — откат по нему упал бы на неизвестной колонке.
    expect(journalData().after).not.toHaveProperty('wantsOrder');
    expect(journalData().before).not.toHaveProperty('wantsOrder');
  });

  it.each(SILENT_PLANS)('план `$action` ничего не пишет', async (plan) => {
    const out = await writeDeal(tx, ctx, plan as Plan<DealData>, '501');

    expect(out).toBeNull();
    expect(dealCreate).not.toHaveBeenCalled();
    expect(journalCreate).not.toHaveBeenCalled();
  });
});

describe('writeDealNote', () => {
  it('пишет заметку датой оригинала и журнал', async () => {
    const data: DealNoteData = {
      dealId: 'd1',
      body: 'Созвонились, ждут счёт',
      authorId: 'm1',
      createdAt: new Date('2020-05-05T08:00:00Z'),
    };

    const out = await writeDealNote(tx, ctx, { action: 'create', data }, '901');

    expect(dealNoteCreate).toHaveBeenCalledWith({
      data: {
        dealId: 'd1',
        body: 'Созвонились, ждут счёт',
        authorId: 'm1',
        createdAt: new Date('2020-05-05T08:00:00Z'),
      },
      select: { id: true },
    });
    expect(journalData()).toMatchObject({
      entity: 'note',
      entityId: 'n1',
      bitrixId: '901',
      action: 'created',
      after: { dealId: 'd1', authorId: 'm1' },
    });
    expect(out).toEqual({ entityId: 'n1', action: 'created', keptManual: [] });
  });

  it('без даты оригинала `createdAt` не выставляется — его поставит база', async () => {
    await writeDealNote(
      tx,
      ctx,
      {
        action: 'create',
        data: { dealId: 'd1', body: 'Текст', authorId: null, createdAt: null },
      },
      '901'
    );

    expect(dealNoteCreate.mock.calls[0][0].data).not.toHaveProperty('createdAt');
  });

  it.each(SILENT_PLANS)('план `$action` ничего не пишет', async (plan) => {
    const out = await writeDealNote(tx, ctx, plan as Plan<DealNoteData>, '901');

    expect(out).toBeNull();
    expect(dealNoteCreate).not.toHaveBeenCalled();
    expect(journalCreate).not.toHaveBeenCalled();
  });

  it('план `update` заметке неведом — ничего не пишет', async () => {
    const out = await writeDealNote(
      tx,
      ctx,
      { action: 'update', id: 'n1', data: {}, before: {} },
      '901'
    );

    expect(out).toBeNull();
    expect(dealNoteCreate).not.toHaveBeenCalled();
  });
});

describe('writeOrganizationNote', () => {
  it('пишет заметку организации датой оригинала и журнал', async () => {
    const data: OrganizationNoteData = {
      companyId: 'c1',
      organizationId: 'o1',
      body: 'О контакте Иван Иванов: перезвонить',
      authorId: 'm1',
      createdAt: new Date('2021-03-03T09:00:00Z'),
    };

    const out = await writeOrganizationNote(tx, ctx, { action: 'create', data }, '902');

    expect(organizationNoteCreate).toHaveBeenCalledWith({
      data: {
        companyId: 'c1',
        organizationId: 'o1',
        body: 'О контакте Иван Иванов: перезвонить',
        authorId: 'm1',
        createdAt: new Date('2021-03-03T09:00:00Z'),
      },
      select: { id: true },
    });
    expect(journalData()).toMatchObject({
      entity: 'note',
      entityId: 'n2',
      bitrixId: '902',
      action: 'created',
      after: { organizationId: 'o1', authorId: 'm1' },
    });
    expect(out).toEqual({ entityId: 'n2', action: 'created', keptManual: [] });
  });

  it('без даты оригинала `createdAt` не выставляется', async () => {
    await writeOrganizationNote(
      tx,
      ctx,
      {
        action: 'create',
        data: {
          companyId: 'c1',
          organizationId: 'o1',
          body: 'Текст',
          authorId: null,
          createdAt: null,
        },
      },
      '902'
    );

    expect(organizationNoteCreate.mock.calls[0][0].data).not.toHaveProperty('createdAt');
  });

  it.each(SILENT_PLANS)('план `$action` ничего не пишет', async (plan) => {
    const out = await writeOrganizationNote(tx, ctx, plan as Plan<OrganizationNoteData>, '902');

    expect(out).toBeNull();
    expect(organizationNoteCreate).not.toHaveBeenCalled();
    expect(journalCreate).not.toHaveBeenCalled();
  });
});

const taskData = (over: Partial<TaskData> = {}): TaskData => ({
  companyId: 'c1',
  title: 'Подготовить КП',
  description: null,
  status: 'in_progress',
  columnId: 'col-1',
  createdById: 'u-importer',
  assigneeIds: ['m1', 'm2'],
  dueDate: null,
  completedAt: null,
  linkedOrganizationId: 'o1',
  linkedDealId: null,
  linkedLeadId: null,
  bitrixId: '701',
  ...over,
});

describe('writeTask', () => {
  it('создаёт задачу с исполнителями и журнал', async () => {
    const out = await writeTask(tx, ctx, { action: 'create', data: taskData() }, '701');

    expect(taskCreate.mock.calls[0][0].data).toMatchObject({
      companyId: 'c1',
      title: 'Подготовить КП',
      columnId: 'col-1',
      bitrixId: '701',
      assignees: { create: [{ userId: 'm1' }, { userId: 'm2' }] },
    });
    expect(journalData()).toMatchObject({
      entity: 'task',
      entityId: 't1',
      action: 'created',
      after: { title: 'Подготовить КП', status: 'in_progress', columnId: 'col-1' },
    });
    expect(out).toEqual({ entityId: 't1', action: 'created', keptManual: [] });
  });

  it('задача без исполнителей — пустой список, а не отсутствие связи', async () => {
    await writeTask(tx, ctx, { action: 'create', data: taskData({ assigneeIds: [] }) }, '701');

    expect(taskCreate.mock.calls[0][0].data.assignees).toEqual({ create: [] });
  });

  it('служебный `assigneeIds` из патча обновления убирается', async () => {
    await writeTask(
      tx,
      ctx,
      {
        action: 'update',
        id: 't1',
        data: { status: 'done', assigneeIds: ['m3'] },
        before: { status: 'in_progress' },
      },
      '701'
    );

    expect(taskUpdate).toHaveBeenCalledWith({ where: { id: 't1' }, data: { status: 'done' } });
  });

  it.each(SILENT_PLANS)('план `$action` ничего не пишет', async (plan) => {
    const out = await writeTask(tx, ctx, plan as Plan<TaskData>, '701');

    expect(out).toBeNull();
    expect(taskCreate).not.toHaveBeenCalled();
    expect(journalCreate).not.toHaveBeenCalled();
  });
});
