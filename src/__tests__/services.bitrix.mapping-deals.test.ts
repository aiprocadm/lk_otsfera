import { describe, expect, it } from 'vitest';

import { planDeal, type DealLookup, type ExistingDeal } from '@/lib/services/bitrix/mapping/deals';
import type { TargetStage } from '@/lib/services/bitrix/mapping/stages';
import type { MappingContext } from '@/lib/services/bitrix/mapping/types';
import type { BitrixDeal } from '@/lib/services/bitrix/source';

/**
 * Этап 2 ТЗ 12.09.2026 «Миграция из Битрикс24» (`У-191`): сделка портала → `Deal`.
 *
 * Запись взята из фикстуры портала: сделка 401 «Охрана труда — Альфа Строй»
 * (компания 101, контакт 201, лид 301, стадия WON).
 */

/** Стадии сделок ЛК: дефолтные (`default:*`) и кастомная с настоящим id. */
const DEAL_STAGES: readonly TargetStage[] = [
  { id: 'default:new', name: 'Новая', statusAnchor: 'open', isTerminal: false },
  { id: 'stage-negotiation', name: 'Переговоры', statusAnchor: 'open', isTerminal: false },
  { id: 'default:won', name: 'Выиграна', statusAnchor: 'won', isTerminal: true },
  { id: 'stage-lost', name: 'Проиграна', statusAnchor: 'lost', isTerminal: true },
];

const CLOSE_DATE = new Date('2025-12-20T00:00:00Z');

function ctxOf(over: Partial<MappingContext> = {}): MappingContext {
  return {
    companyId: 'company-1',
    importerId: 'user-importer',
    defaultManagerId: 'user-default',
    tables: {
      // Ключ — «направление:стадия»: у общего направления Битрикса это «0».
      stageMap: {
        '0:WON': 'default:won',
        '0:EXECUTING': 'stage-negotiation',
        '0:LOSE': 'stage-lost',
        '3:WON': 'stage-negotiation',
      },
      leadStageMap: {},
      taskColumnMap: {},
      userMap: {},
    },
    resolveUser: (id) => (id === '1' ? 'user-ivan' : null),
    ...over,
  };
}

function dealOf(over: Partial<BitrixDeal> = {}): BitrixDeal {
  return {
    id: '401',
    title: 'Охрана труда — Альфа Строй',
    categoryId: '0',
    stageId: 'WON',
    opportunity: '120000',
    companyId: '101',
    contactId: '201',
    leadId: '301',
    assignedById: '1',
    createdAt: new Date('2025-10-05T09:00:00Z'),
    closeDate: CLOSE_DATE,
    closed: true,
    comments: null,
    ...over,
  };
}

function lookupOf(over: Partial<DealLookup> = {}): DealLookup {
  return {
    byBitrixId: () => undefined,
    organizationByBitrixId: (id) => (id === '101' ? 'org-1' : undefined),
    contactByBitrixId: (id) => (id === '201' ? 'contact-1' : undefined),
    leadByBitrixId: (id) => (id === '301' ? 'lead-1' : undefined),
    ...over,
  };
}

const EXISTING: ExistingDeal = {
  id: 'deal-1',
  title: 'Охрана труда — Альфа Строй',
  status: 'won',
  stageId: 'default:won',
  orderId: null,
  organizationId: 'org-1',
  wonAt: new Date('2025-12-20T00:00:00Z'),
  lostAt: null,
};

describe('planDeal — стадия: ключ из направления и стадии', () => {
  it('стадия не сопоставлена → конфликт stage_not_mapped с подсказкой про стадию', () => {
    const plan = planDeal(dealOf({ stageId: 'PREPARATION' }), ctxOf(), lookupOf(), DEAL_STAGES);

    expect(plan).toEqual({
      action: 'conflict',
      reason: 'stage_not_mapped',
      hint: 'стадия «PREPARATION»',
    });
  });

  it('стадия сопоставлена в null → тот же конфликт', () => {
    const ctx = ctxOf();
    const plan = planDeal(
      dealOf(),
      ctxOf({ tables: { ...ctx.tables, stageMap: { '0:WON': null } } }),
      lookupOf(),
      DEAL_STAGES
    );

    expect(plan).toMatchObject({ action: 'conflict', reason: 'stage_not_mapped' });
  });

  it('выбранной стадии в справочнике ЛК больше нет → конфликт, а не молчаливый перенос', () => {
    const ctx = ctxOf();
    const plan = planDeal(
      dealOf(),
      ctxOf({ tables: { ...ctx.tables, stageMap: { '0:WON': 'stage-deleted' } } }),
      lookupOf(),
      DEAL_STAGES
    );

    expect(plan).toMatchObject({ action: 'conflict', reason: 'stage_not_mapped' });
  });

  it('направление «0» и направление «3» с одинаковой стадией — разные ключи и разный итог', () => {
    const common = planDeal(dealOf({ categoryId: '0' }), ctxOf(), lookupOf(), DEAL_STAGES);
    const third = planDeal(dealOf({ categoryId: '3' }), ctxOf(), lookupOf(), DEAL_STAGES);

    expect(common).toMatchObject({ action: 'create', data: { status: 'won' } });
    expect(third).toMatchObject({
      action: 'create',
      data: { status: 'open', stageId: 'stage-negotiation' },
    });
  });

  it('пустое направление считается общим «0»', () => {
    const plan = planDeal(dealOf({ categoryId: '' }), ctxOf(), lookupOf(), DEAL_STAGES);

    expect(plan).toMatchObject({ action: 'create', data: { status: 'won' } });
  });
});

describe('planDeal — статус из якоря стадии и даты закрытия', () => {
  it('выигранная сделка: дата закрытия — факт победы', () => {
    const plan = planDeal(dealOf(), ctxOf(), lookupOf(), DEAL_STAGES);

    expect(plan).toEqual({
      action: 'create',
      data: {
        companyId: 'company-1',
        title: 'Охрана труда — Альфа Строй',
        amount: '120000',
        status: 'won',
        // `default:won` — синтетическая стадия, в строку её писать нельзя.
        stageId: null,
        organizationId: 'org-1',
        contactId: 'contact-1',
        leadId: 'lead-1',
        managerId: 'user-ivan',
        expectedCloseAt: null,
        wonAt: CLOSE_DATE,
        lostAt: null,
        bitrixId: '401',
        wantsOrder: true,
      },
    });
  });

  it('открытая сделка: дата закрытия — план, заказ не просится', () => {
    const plan = planDeal(
      dealOf({ id: '402', stageId: 'EXECUTING', closeDate: CLOSE_DATE }),
      ctxOf(),
      lookupOf(),
      DEAL_STAGES
    );

    expect(plan).toMatchObject({
      action: 'create',
      data: {
        status: 'open',
        // Настоящий id стадии сохраняется как есть.
        stageId: 'stage-negotiation',
        expectedCloseAt: CLOSE_DATE,
        wonAt: null,
        lostAt: null,
        wantsOrder: false,
      },
    });
  });

  it('проигранная сделка: дата закрытия — факт отказа, заказ не просится', () => {
    const plan = planDeal(dealOf({ id: '404', stageId: 'LOSE' }), ctxOf(), lookupOf(), DEAL_STAGES);

    expect(plan).toMatchObject({
      action: 'create',
      data: {
        status: 'lost',
        stageId: 'stage-lost',
        expectedCloseAt: null,
        wonAt: null,
        lostAt: CLOSE_DATE,
        wantsOrder: false,
      },
    });
  });

  it('даты закрытия нет → все три даты пустые', () => {
    const plan = planDeal(
      dealOf({ stageId: 'EXECUTING', closeDate: null }),
      ctxOf(),
      lookupOf(),
      DEAL_STAGES
    );

    expect(plan).toMatchObject({
      action: 'create',
      data: { expectedCloseAt: null, wonAt: null, lostAt: null },
    });
  });
});

describe('planDeal — связи и умолчания', () => {
  it('связей в Битриксе нет → все три ссылки пустые, lookup не спрашивается', () => {
    const plan = planDeal(
      dealOf({ id: '406', companyId: null, contactId: null, leadId: null }),
      ctxOf(),
      lookupOf({
        organizationByBitrixId: () => 'org-не-должен-спрашиваться',
        contactByBitrixId: () => 'contact-не-должен-спрашиваться',
        leadByBitrixId: () => 'lead-не-должен-спрашиваться',
      }),
      DEAL_STAGES
    );

    expect(plan).toMatchObject({
      action: 'create',
      data: { organizationId: null, contactId: null, leadId: null },
    });
  });

  it('связь есть, но запись не перенеслась → ссылка пустая', () => {
    const plan = planDeal(
      dealOf({ companyId: '999', contactId: '999', leadId: '999' }),
      ctxOf(),
      lookupOf(),
      DEAL_STAGES
    );

    expect(plan).toMatchObject({
      action: 'create',
      data: { organizationId: null, contactId: null, leadId: null },
    });
  });

  it('ответственный не сопоставлен → менеджер по умолчанию', () => {
    const plan = planDeal(dealOf({ assignedById: '3' }), ctxOf(), lookupOf(), DEAL_STAGES);

    expect(plan).toMatchObject({ action: 'create', data: { managerId: 'user-default' } });
  });

  it('ответственного нет и умолчания нет → сделка без менеджера (она видна по компании)', () => {
    const plan = planDeal(
      dealOf({ assignedById: null }),
      ctxOf({ defaultManagerId: null }),
      lookupOf(),
      DEAL_STAGES
    );

    expect(plan).toMatchObject({ action: 'create', data: { managerId: null } });
  });

  it('пустое название заменяется на «Сделка Битрикс24 #id»', () => {
    const plan = planDeal(dealOf({ id: '777', title: '   ' }), ctxOf(), lookupOf(), DEAL_STAGES);

    expect(plan).toMatchObject({
      action: 'create',
      data: { title: 'Сделка Битрикс24 #777' },
    });
  });

  it('сумма не указана → null', () => {
    const plan = planDeal(dealOf({ opportunity: null }), ctxOf(), lookupOf(), DEAL_STAGES);

    expect(plan).toMatchObject({ action: 'create', data: { amount: null } });
  });
});

describe('planDeal — повторный перенос той же сделки', () => {
  it('изменилось название → update одного поля со снимком «как было»', () => {
    const plan = planDeal(
      dealOf({ title: 'Охрана труда — Альфа Строй (2026)' }),
      ctxOf(),
      lookupOf({ byBitrixId: () => EXISTING }),
      DEAL_STAGES
    );

    expect(plan).toEqual({
      action: 'update',
      id: 'deal-1',
      data: { title: 'Охрана труда — Альфа Строй (2026)' },
      before: { title: 'Охрана труда — Альфа Строй' },
    });
  });

  it('изменился статус → вместе с ним переписываются стадия и даты', () => {
    const plan = planDeal(
      dealOf({ stageId: 'LOSE' }),
      ctxOf(),
      lookupOf({ byBitrixId: () => EXISTING }),
      DEAL_STAGES
    );

    expect(plan).toEqual({
      action: 'update',
      id: 'deal-1',
      data: { status: 'lost', stageId: 'stage-lost', wonAt: null, lostAt: CLOSE_DATE },
      // Даты победы и поражения переписываются вместе со статусом, поэтому обе
      // обязаны попасть в снимок — иначе прежняя дата победы пропадёт.
      before: {
        status: 'won',
        stageId: 'default:won',
        wonAt: new Date('2025-12-20T00:00:00Z'),
        lostAt: null,
      },
    });
  });

  it('организация нашлась и отличается от прежней → переписывается со снимком', () => {
    const plan = planDeal(
      dealOf(),
      ctxOf(),
      lookupOf({
        byBitrixId: () => ({ ...EXISTING, organizationId: 'org-старая' }),
        organizationByBitrixId: () => 'org-1',
      }),
      DEAL_STAGES
    );

    expect(plan).toEqual({
      action: 'update',
      id: 'deal-1',
      data: { organizationId: 'org-1' },
      before: { organizationId: 'org-старая' },
    });
  });

  it('организация не нашлась → прежнюю связь не стираем', () => {
    const plan = planDeal(
      dealOf({ companyId: '999' }),
      ctxOf(),
      lookupOf({ byBitrixId: () => ({ ...EXISTING, organizationId: 'org-старая' }) }),
      DEAL_STAGES
    );

    expect(plan).toEqual({ action: 'skip', reason: 'no_changes', id: 'deal-1' });
  });

  it('всё совпало → skip no_changes', () => {
    const plan = planDeal(dealOf(), ctxOf(), lookupOf({ byBitrixId: () => EXISTING }), DEAL_STAGES);

    expect(plan).toEqual({ action: 'skip', reason: 'no_changes', id: 'deal-1' });
  });
});
