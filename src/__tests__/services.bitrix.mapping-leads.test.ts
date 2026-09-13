import { describe, expect, it } from 'vitest';

import {
  NO_CLIENT_NAME,
  NO_SUBJECT,
  planLead,
  type ExistingLead,
  type LeadLookup,
} from '@/lib/services/bitrix/mapping/leads';
import type { TargetStage } from '@/lib/services/bitrix/mapping/stages';
import type { MappingContext } from '@/lib/services/bitrix/mapping/types';
import type { BitrixLead } from '@/lib/services/bitrix/source';

/**
 * Этап 2 ТЗ 12.09.2026 «Миграция из Битрикс24» (`У-191`): лид портала → `Lead`.
 *
 * Записи взяты из фикстуры портала (`fixtures/portal.ts`): лид 301 «Обучение по
 * охране труда» у «Альфа Строй» и пустой спам-лид 304.
 */

/** Стадии воронки ЛК: дефолтные (`default:*`) и кастомная с настоящим id. */
const FUNNEL_STAGES: readonly TargetStage[] = [
  { id: 'default:new', name: 'Новый лид', statusAnchor: 'new', isTerminal: false },
  { id: 'funnel-in-review', name: 'В работе', statusAnchor: 'in_review', isTerminal: false },
  {
    id: 'default:promoted_to_deal',
    name: 'Передан в сделку',
    statusAnchor: 'promoted_to_deal',
    isTerminal: true,
  },
  { id: 'funnel-rejected', name: 'Отказ', statusAnchor: 'rejected', isTerminal: true },
];

/**
 * ИНН у лида — с верной контрольной суммой: у фикстуры портала номера
 * условные, а `planLead` переносит только проверенный ИНН.
 */
const INN_ALFA = '7707083893';

function ctxOf(over: Partial<MappingContext> = {}): MappingContext {
  return {
    companyId: 'company-1',
    importerId: 'user-importer',
    defaultManagerId: 'user-default',
    tables: {
      stageMap: {},
      leadStageMap: { CONVERTED: 'default:promoted_to_deal', IN_PROCESS: 'funnel-in-review' },
      taskColumnMap: {},
      userMap: {},
    },
    resolveUser: (id) => (id === '1' ? 'user-ivan' : null),
    ...over,
  };
}

function leadOf(over: Partial<BitrixLead> = {}): BitrixLead {
  return {
    id: '301',
    title: 'Обучение по охране труда — 12 человек',
    name: 'Анна Иванова',
    companyTitle: 'ООО «Альфа Строй»',
    phones: ['+7 (921) 111-22-33'],
    emails: ['ivanova@alfa-stroy.local'],
    inn: INN_ALFA,
    statusId: 'CONVERTED',
    assignedById: '1',
    opportunity: '120000',
    createdAt: new Date('2025-10-01T09:00:00Z'),
    comments: 'Сконвертирован в сделку 401',
    ...over,
  };
}

function lookupOf(over: Partial<LeadLookup> = {}): LeadLookup {
  return {
    byBitrixId: () => undefined,
    organizationByName: () => undefined,
    ...over,
  };
}

const EXISTING: ExistingLead = {
  id: 'lead-1',
  subject: 'Обучение по охране труда — 12 человек',
  status: 'promoted_to_deal',
  funnelStageId: 'default:promoted_to_deal',
};

describe('planLead — конфликты: переносить нельзя, решает человек', () => {
  it('ответственный не сопоставлен и менеджера по умолчанию нет → конфликт no_manager', () => {
    const plan = planLead(
      leadOf({ assignedById: '3' }),
      ctxOf({ defaultManagerId: null }),
      lookupOf(),
      FUNNEL_STAGES
    );

    expect(plan).toEqual({
      action: 'conflict',
      reason: 'no_manager',
      hint: 'лид без ответственного не виден никому — выберите менеджера по умолчанию',
    });
  });

  it('ответственного в портале нет вовсе и умолчания нет → тот же конфликт', () => {
    const plan = planLead(
      leadOf({ assignedById: null }),
      ctxOf({ defaultManagerId: null }),
      lookupOf(),
      FUNNEL_STAGES
    );

    expect(plan).toMatchObject({ action: 'conflict', reason: 'no_manager' });
  });

  it('статус лида не сопоставлен → конфликт stage_not_mapped с подсказкой про статус', () => {
    const plan = planLead(leadOf({ statusId: 'JUNK' }), ctxOf(), lookupOf(), FUNNEL_STAGES);

    expect(plan).toEqual({
      action: 'conflict',
      reason: 'stage_not_mapped',
      hint: 'статус «JUNK»',
    });
  });

  it('статус сопоставлен в null — тот же конфликт', () => {
    const ctx = ctxOf();
    const plan = planLead(
      leadOf({ statusId: 'NEW' }),
      ctxOf({ tables: { ...ctx.tables, leadStageMap: { ...ctx.tables.leadStageMap, NEW: null } } }),
      lookupOf(),
      FUNNEL_STAGES
    );

    expect(plan).toMatchObject({ action: 'conflict', hint: 'статус «NEW»' });
  });

  it('стадия выбрана, но такой стадии в воронке уже нет → конфликт, а не молчаливый перенос', () => {
    const ctx = ctxOf();
    const plan = planLead(
      leadOf(),
      ctxOf({
        tables: { ...ctx.tables, leadStageMap: { CONVERTED: 'funnel-deleted' } },
      }),
      lookupOf(),
      FUNNEL_STAGES
    );

    expect(plan).toMatchObject({ action: 'conflict', reason: 'stage_not_mapped' });
  });
});

describe('planLead — создание новой записи', () => {
  it('успешный перенос: источник bitrix, статус из якоря стадии, ответственный он же автор', () => {
    const plan = planLead(
      leadOf(),
      ctxOf(),
      lookupOf({
        organizationByName: (name) => (name === 'ООО «Альфа Строй»' ? 'org-1' : undefined),
      }),
      FUNNEL_STAGES
    );

    expect(plan).toEqual({
      action: 'create',
      data: {
        source: 'bitrix',
        status: 'promoted_to_deal',
        // `default:*` — синтетическая стадия, в строку её писать нельзя.
        funnelStageId: null,
        subject: 'Обучение по охране труда — 12 человек',
        clientCompanyName: 'ООО «Альфа Строй»',
        clientContactName: 'Анна Иванова',
        clientContactPhone: '+7 (921) 111-22-33',
        clientContactEmail: 'ivanova@alfa-stroy.local',
        clientInn: INN_ALFA,
        estimatedAmount: '120000',
        organizationId: 'org-1',
        assignedManagerId: 'user-ivan',
        createdByUserId: 'user-ivan',
        notes: 'Сконвертирован в сделку 401',
        bitrixId: '301',
      },
    });
  });

  it('настоящий id стадии сохраняется как есть', () => {
    const plan = planLead(leadOf({ statusId: 'IN_PROCESS' }), ctxOf(), lookupOf(), FUNNEL_STAGES);

    expect(plan).toMatchObject({
      action: 'create',
      data: { status: 'in_review', funnelStageId: 'funnel-in-review' },
    });
  });

  it('ответственный не сопоставлен, но есть менеджер по умолчанию → он и ответственный, и автор', () => {
    const plan = planLead(leadOf({ assignedById: '3' }), ctxOf(), lookupOf(), FUNNEL_STAGES);

    expect(plan).toMatchObject({
      action: 'create',
      data: { assignedManagerId: 'user-default', createdByUserId: 'user-default' },
    });
  });

  it('пустые название, имя и компания заменяются константами', () => {
    const plan = planLead(
      leadOf({ id: '304', title: '   ', name: '', companyTitle: null, statusId: 'IN_PROCESS' }),
      ctxOf(),
      lookupOf(),
      FUNNEL_STAGES
    );

    expect(plan).toMatchObject({
      action: 'create',
      data: {
        subject: NO_SUBJECT,
        clientCompanyName: NO_CLIENT_NAME,
        clientContactName: NO_CLIENT_NAME,
        organizationId: null,
      },
    });
  });

  it('название компании из одних пробелов — тоже «пусто»: организацию по нему не ищем', () => {
    let asked = false;
    const plan = planLead(
      leadOf({ companyTitle: '   ', statusId: 'IN_PROCESS' }),
      ctxOf(),
      lookupOf({
        organizationByName: () => {
          asked = true;
          return 'org-1';
        },
      }),
      FUNNEL_STAGES
    );

    expect(asked).toBe(false);
    expect(plan).toMatchObject({
      action: 'create',
      data: { clientCompanyName: NO_CLIENT_NAME, organizationId: null },
    });
  });

  it('организация по названию не найдена → organizationId остаётся пустым', () => {
    const plan = planLead(
      leadOf({ statusId: 'IN_PROCESS' }),
      ctxOf(),
      lookupOf({ organizationByName: () => undefined }),
      FUNNEL_STAGES
    );

    expect(plan).toMatchObject({ action: 'create', data: { organizationId: null } });
  });

  it('телефон и почта берутся первыми из массивов', () => {
    const plan = planLead(
      leadOf({
        statusId: 'IN_PROCESS',
        phones: ['+7 911 000 00 01', '+7 911 000 00 02'],
        emails: ['first@demo.local', 'second@demo.local'],
      }),
      ctxOf(),
      lookupOf(),
      FUNNEL_STAGES
    );

    expect(plan).toMatchObject({
      action: 'create',
      data: { clientContactPhone: '+7 911 000 00 01', clientContactEmail: 'first@demo.local' },
    });
  });

  it('пустые массивы телефонов и почт → null, а не пустая строка', () => {
    const plan = planLead(
      leadOf({ statusId: 'IN_PROCESS', phones: [], emails: [] }),
      ctxOf(),
      lookupOf(),
      FUNNEL_STAGES
    );

    expect(plan).toMatchObject({
      action: 'create',
      data: { clientContactPhone: null, clientContactEmail: null },
    });
  });

  it('ИНН нормализуется: пробелы убираются, ведущий ноль восстанавливается', () => {
    const plan = planLead(
      // Excel отдал ИНН числом — ведущий ноль потерялся, внутри остались пробелы.
      leadOf({ statusId: 'IN_PROCESS', inn: ' 277 071 080 ' }),
      ctxOf(),
      lookupOf(),
      FUNNEL_STAGES
    );

    expect(plan).toMatchObject({ action: 'create', data: { clientInn: '0277071080' } });
  });

  it('невалидный ИНН отбрасывается — переносим только проверенный', () => {
    const plan = planLead(
      // Та же длина, но битая контрольная цифра.
      leadOf({ statusId: 'IN_PROCESS', inn: '7707083894' }),
      ctxOf(),
      lookupOf(),
      FUNNEL_STAGES
    );

    expect(plan).toMatchObject({ action: 'create', data: { clientInn: null } });
  });

  it('ИНН не прислали → null', () => {
    const plan = planLead(
      leadOf({ statusId: 'IN_PROCESS', inn: null }),
      ctxOf(),
      lookupOf(),
      FUNNEL_STAGES
    );

    expect(plan).toMatchObject({ action: 'create', data: { clientInn: null } });
  });

  it('комментарий из одних пробелов и отсутствие комментария дают одинаковый null', () => {
    const blank = planLead(
      leadOf({ statusId: 'IN_PROCESS', comments: '   ' }),
      ctxOf(),
      lookupOf(),
      FUNNEL_STAGES
    );
    const missing = planLead(
      leadOf({ statusId: 'IN_PROCESS', comments: null }),
      ctxOf(),
      lookupOf(),
      FUNNEL_STAGES
    );

    expect(blank).toMatchObject({ action: 'create', data: { notes: null } });
    expect(missing).toMatchObject({ action: 'create', data: { notes: null } });
  });

  it('сумма лида переносится как есть, пустая — null', () => {
    const plan = planLead(
      leadOf({ statusId: 'IN_PROCESS', opportunity: null }),
      ctxOf(),
      lookupOf(),
      FUNNEL_STAGES
    );

    expect(plan).toMatchObject({ action: 'create', data: { estimatedAmount: null } });
  });
});

describe('planLead — повторный перенос того же лида', () => {
  it('изменилось только название → update с одним полем и снимком «как было»', () => {
    const plan = planLead(
      leadOf({ title: 'Обучение по охране труда — 20 человек' }),
      ctxOf(),
      lookupOf({ byBitrixId: () => EXISTING }),
      FUNNEL_STAGES
    );

    expect(plan).toEqual({
      action: 'update',
      id: 'lead-1',
      data: { subject: 'Обучение по охране труда — 20 человек' },
      before: { subject: 'Обучение по охране труда — 12 человек' },
    });
  });

  it('изменился статус → вместе с ним переписывается стадия воронки', () => {
    const plan = planLead(
      leadOf({ statusId: 'IN_PROCESS' }),
      ctxOf(),
      lookupOf({ byBitrixId: () => EXISTING }),
      FUNNEL_STAGES
    );

    expect(plan).toEqual({
      action: 'update',
      id: 'lead-1',
      data: { status: 'in_review', funnelStageId: 'funnel-in-review' },
      // Стадия воронки меняется вместе со статусом, поэтому она обязана быть
      // и в снимке: иначе откат вернул бы статус, но не стадию.
      before: { status: 'promoted_to_deal', funnelStageId: 'default:promoted_to_deal' },
    });
  });

  it('изменились и название, и статус → в снимке оба поля', () => {
    const plan = planLead(
      leadOf({ title: 'Новое название', statusId: 'IN_PROCESS' }),
      ctxOf(),
      lookupOf({ byBitrixId: () => EXISTING }),
      FUNNEL_STAGES
    );

    expect(plan).toEqual({
      action: 'update',
      id: 'lead-1',
      data: {
        subject: 'Новое название',
        status: 'in_review',
        funnelStageId: 'funnel-in-review',
      },
      before: {
        subject: 'Обучение по охране труда — 12 человек',
        status: 'promoted_to_deal',
        funnelStageId: 'default:promoted_to_deal',
      },
    });
  });

  it('ничего не изменилось → skip no_changes', () => {
    const plan = planLead(
      leadOf(),
      ctxOf(),
      lookupOf({ byBitrixId: () => EXISTING }),
      FUNNEL_STAGES
    );

    expect(plan).toEqual({ action: 'skip', reason: 'no_changes' });
  });
});
