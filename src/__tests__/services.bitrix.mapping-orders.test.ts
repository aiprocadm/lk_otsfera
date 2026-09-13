import { describe, expect, it } from 'vitest';

import {
  AMOUNT_TOLERANCE,
  DAYS_TOLERANCE,
  bitrixOrderExternalId,
  findMatchingOrder,
  isOneCOrder,
  planOrderForWonDeal,
  type CandidateOrder,
} from '@/lib/services/bitrix/mapping/orders';
import type { MappingContext } from '@/lib/services/bitrix/mapping/types';
import type { BitrixDeal } from '@/lib/services/bitrix/source';

/**
 * Этап 2 ТЗ 12.09.2026 «Миграция из Битрикс24» (`У-197`, `Р-Б-2`): выигранная
 * сделка → заказ. Сначала ищем готовый заказ 1С той же организации (сумма ±1 %,
 * дата ±30 дней) — второй заказ на ту же работу заводить нельзя.
 */

const CLOSE_DATE = new Date('2025-12-20T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** Дата, отстоящая от даты закрытия сделки ровно на `days` суток. */
const closeDatePlusDays = (days: number): Date => new Date(CLOSE_DATE.getTime() + days * DAY_MS);

function ctxOf(over: Partial<MappingContext> = {}): MappingContext {
  return {
    companyId: 'company-1',
    importerId: 'user-importer',
    defaultManagerId: 'user-default',
    tables: { stageMap: {}, leadStageMap: {}, taskColumnMap: {}, userMap: {} },
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
    opportunity: '100000',
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

function orderOf(over: Partial<CandidateOrder> = {}): CandidateOrder {
  return {
    id: 'order-1c-1',
    externalId: '1c:000012345',
    orderNumber: 'ЗК-2025-0042',
    totalAmount: '100000',
    closedAt: CLOSE_DATE,
    completedAt: null,
    ...over,
  };
}

describe('isOneCOrder — какой заказ вообще годится в кандидаты', () => {
  it('заказ с внешним ключом 1С — годится', () => {
    expect(isOneCOrder(orderOf())).toBe(true);
  });

  it('заказ без внешнего ключа — заведён в ЛК руками, не кандидат', () => {
    expect(isOneCOrder(orderOf({ externalId: null }))).toBe(false);
  });

  it('пустой внешний ключ — тоже не кандидат', () => {
    expect(isOneCOrder(orderOf({ externalId: '' }))).toBe(false);
  });

  it('наш собственный заказ из Битрикса — не кандидат', () => {
    expect(isOneCOrder(orderOf({ externalId: 'bitrix:deal:401' }))).toBe(false);
  });
});

describe('bitrixOrderExternalId — ключ заказа-истории', () => {
  it('склеивается из префикса и номера сделки', () => {
    expect(bitrixOrderExternalId('401')).toBe('bitrix:deal:401');
  });
});

describe('findMatchingOrder — похожесть по сумме и дате', () => {
  it('сумма совпала точно и дата та же → совпадение', () => {
    expect(findMatchingOrder(dealOf(), [orderOf()])?.id).toBe('order-1c-1');
  });

  it('расхождение ровно в 1 % ещё считается совпадением', () => {
    const order = orderOf({ totalAmount: '99000' });

    expect(Math.abs(100000 - 99000) / 100000).toBe(AMOUNT_TOLERANCE);
    expect(findMatchingOrder(dealOf(), [order])?.id).toBe('order-1c-1');
  });

  it('расхождение чуть больше 1 % — уже не то', () => {
    expect(findMatchingOrder(dealOf(), [orderOf({ totalAmount: '98999' })])).toBeUndefined();
  });

  it('разница ровно в 30 дней ещё считается совпадением', () => {
    const order = orderOf({ closedAt: closeDatePlusDays(DAYS_TOLERANCE) });

    expect(findMatchingOrder(dealOf(), [order])?.id).toBe('order-1c-1');
  });

  it('31 день — уже не то', () => {
    const order = orderOf({ closedAt: closeDatePlusDays(DAYS_TOLERANCE + 1) });

    expect(findMatchingOrder(dealOf(), [order])).toBeUndefined();
  });

  it('даты нет у заказа → решает только сумма', () => {
    const order = orderOf({ closedAt: null, completedAt: null });

    expect(findMatchingOrder(dealOf(), [order])?.id).toBe('order-1c-1');
  });

  it('даты нет у сделки → решает только сумма', () => {
    const order = orderOf({ closedAt: closeDatePlusDays(365) });

    expect(findMatchingOrder(dealOf({ closeDate: null }), [order])?.id).toBe('order-1c-1');
  });

  it('у заказа нет даты закрытия, но есть дата выполнения — сравниваем по ней', () => {
    const near = orderOf({ closedAt: null, completedAt: closeDatePlusDays(1) });
    const far = orderOf({ closedAt: null, completedAt: closeDatePlusDays(90) });

    expect(findMatchingOrder(dealOf(), [near])?.id).toBe('order-1c-1');
    expect(findMatchingOrder(dealOf(), [far])).toBeUndefined();
  });

  it('нечисловая сумма сделки → совпадений нет вовсе', () => {
    expect(findMatchingOrder(dealOf({ opportunity: 'договорная' }), [orderOf()])).toBeUndefined();
  });

  it('нулевые суммы совпадают только друг с другом', () => {
    const zeroDeal = dealOf({ opportunity: '0' });

    expect(findMatchingOrder(zeroDeal, [orderOf({ totalAmount: '0' })])?.id).toBe('order-1c-1');
    expect(findMatchingOrder(zeroDeal, [orderOf({ totalAmount: '5000' })])).toBeUndefined();
    expect(findMatchingOrder(dealOf(), [orderOf({ totalAmount: '0' })])).toBeUndefined();
  });

  it('сумма сделки не указана — совпадений нет, даже с нулевым заказом', () => {
    // Пустая строка в JavaScript превращается в ноль, и без отдельной проверки
    // сделка без суммы прилипала бы к любому нулевому заказу той же
    // организации. Нет суммы — сравнивать нечего, заводим свой заказ.
    const deal = dealOf({ opportunity: null });

    expect(findMatchingOrder(deal, [orderOf({ totalAmount: '0' })])).toBeUndefined();
    expect(findMatchingOrder(deal, [orderOf()])).toBeUndefined();
    expect(
      findMatchingOrder(dealOf({ opportunity: '' }), [orderOf({ totalAmount: '0' })])
    ).toBeUndefined();
  });

  it('заказы не из 1С пропускаются, даже если сумма и дата сходятся', () => {
    const ours = orderOf({ id: 'order-bitrix', externalId: 'bitrix:deal:999' });
    const manual = orderOf({ id: 'order-manual', externalId: null });

    expect(findMatchingOrder(dealOf(), [ours, manual])).toBeUndefined();
  });

  it('берётся первый подходящий из списка', () => {
    const first = orderOf({ id: 'order-A' });
    const second = orderOf({ id: 'order-B' });

    expect(findMatchingOrder(dealOf(), [first, second])?.id).toBe('order-A');
  });

  it('список пуст → совпадений нет', () => {
    expect(findMatchingOrder(dealOf(), [])).toBeUndefined();
  });
});

describe('planOrderForWonDeal — что делать с выигранной сделкой', () => {
  it('организации нет → заказ вешать не на кого', () => {
    const plan = planOrderForWonDeal(dealOf(), ctxOf(), {
      organizationId: null,
      orders: [orderOf()],
      closedStatusId: 'status-closed',
    });

    expect(plan).toEqual({ action: 'skip', reason: 'no_organization' });
  });

  it('заказ по этой сделке уже переносили → ничего не делаем', () => {
    const own = orderOf({ id: 'order-own', externalId: bitrixOrderExternalId('401') });
    const plan = planOrderForWonDeal(dealOf(), ctxOf(), {
      organizationId: 'org-1',
      orders: [own],
      closedStatusId: 'status-closed',
    });

    expect(plan).toEqual({ action: 'skip', reason: 'already_linked' });
  });

  it('нашёлся заказ 1С → привязываем к нему, подпись — номер заказа', () => {
    const plan = planOrderForWonDeal(dealOf(), ctxOf(), {
      organizationId: 'org-1',
      orders: [orderOf()],
      closedStatusId: 'status-closed',
    });

    expect(plan).toEqual({
      action: 'link',
      orderId: 'order-1c-1',
      orderLabel: 'ЗК-2025-0042',
    });
  });

  it('у найденного заказа нет номера → подпись берётся из внешнего ключа', () => {
    const plan = planOrderForWonDeal(dealOf(), ctxOf(), {
      organizationId: 'org-1',
      orders: [orderOf({ orderNumber: null })],
      closedStatusId: 'status-closed',
    });

    expect(plan).toEqual({
      action: 'link',
      orderId: 'order-1c-1',
      orderLabel: '1c:000012345',
    });
  });

  it('подходящего заказа нет → заводим заказ-историю: выполнен, без денег, закрыт', () => {
    const plan = planOrderForWonDeal(dealOf(), ctxOf(), {
      organizationId: 'org-1',
      orders: [],
      closedStatusId: 'status-closed',
    });

    expect(plan).toEqual({
      action: 'create',
      data: {
        externalId: 'bitrix:deal:401',
        title: 'Охрана труда — Альфа Строй',
        companyId: 'company-1',
        organizationId: 'org-1',
        managerId: 'user-ivan',
        totalAmount: '100000',
        statusId: 'status-closed',
        executionStatus: 'completed',
        financialStatus: 'not_billed',
        closedAt: CLOSE_DATE,
        completedAt: CLOSE_DATE,
      },
    });
  });

  it('статуса с якорем «закрыт» у компании нет → заказ остаётся без статуса', () => {
    const plan = planOrderForWonDeal(dealOf(), ctxOf(), {
      organizationId: 'org-1',
      orders: [],
      closedStatusId: null,
    });

    expect(plan).toMatchObject({ action: 'create', data: { statusId: null } });
  });

  it('пустое название → «Заказ по сделке Битрикс24 #id», сумма по умолчанию «0»', () => {
    const plan = planOrderForWonDeal(
      dealOf({ id: '777', title: '  ', opportunity: null }),
      ctxOf(),
      {
        organizationId: 'org-1',
        orders: [],
        closedStatusId: null,
      }
    );

    expect(plan).toMatchObject({
      action: 'create',
      data: {
        externalId: 'bitrix:deal:777',
        title: 'Заказ по сделке Битрикс24 #777',
        totalAmount: '0',
      },
    });
  });

  it('ответственный не сопоставлен → менеджер по умолчанию', () => {
    const plan = planOrderForWonDeal(dealOf({ assignedById: '3' }), ctxOf(), {
      organizationId: 'org-1',
      orders: [],
      closedStatusId: null,
    });

    expect(plan).toMatchObject({ action: 'create', data: { managerId: 'user-default' } });
  });

  it('ответственного нет и умолчания нет → заказ без менеджера', () => {
    const plan = planOrderForWonDeal(
      dealOf({ assignedById: null }),
      ctxOf({ defaultManagerId: null }),
      { organizationId: 'org-1', orders: [], closedStatusId: null }
    );

    expect(plan).toMatchObject({ action: 'create', data: { managerId: null } });
  });

  it('даты закрытия нет → обе даты заказа пустые', () => {
    const plan = planOrderForWonDeal(dealOf({ closeDate: null }), ctxOf(), {
      organizationId: 'org-1',
      orders: [],
      closedStatusId: null,
    });

    expect(plan).toMatchObject({ action: 'create', data: { closedAt: null, completedAt: null } });
  });
});
