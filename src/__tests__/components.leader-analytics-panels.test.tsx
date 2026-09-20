import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { KpiPlanFactTable } from '@/components/leader/analytics/kpi-plan-fact-table';
import { SourcesPanel } from '@/components/leader/analytics/sources-panel';
import { PartnersAnalyticsPanel } from '@/components/leader/analytics/partners-analytics-panel';
import { CommunicationsPanel } from '@/components/leader/analytics/communications-panel';
import { ReceivablesPanel } from '@/components/leader/analytics/receivables-panel';

/**
 * Пять панелей вкладки «Аналитика» руководителя (`У-242`, `У-243`, `У-247`).
 *
 * Панели чисто презентационные, поэтому отрисовываются на сервере — без
 * браузера. Смотрим на то, что видит человек: пустой экран обязан объяснять,
 * почему он пуст и что делать (`У-74`), а прочерк вместо «0 %» — не
 * придирка, а требование: «0 %» под пустым планом читается как невыполнение
 * того, чего человеку не ставили.
 */
function html(node: React.ReactElement): string {
  // `renderToString` разделяет соседние текстовые узлы служебной вставкой
  // `<!-- -->`, и строка «пропустили: 1» в разметке выглядит как
  // «пропустили: <!-- -->1». Убираем вставки, чтобы проверять то, что видит
  // человек, а не то, как React склеил куски.
  return renderToString(node).replaceAll('<!-- -->', '');
}

describe('KpiPlanFactTable — план и факт', () => {
  const row = (over: Partial<Parameters<typeof KpiPlanFactTable>[0]['data']['rows'][number]>) => ({
    metric: 'deals' as const,
    metricLabel: 'Сделки',
    unit: 'count' as const,
    managerId: 'm1',
    managerName: 'Иванов',
    plan: '10',
    fact: '5',
    percent: 50,
    prevFact: '4',
    ...over,
  });

  it('без выбранных показателей объясняет, куда идти', () => {
    const out = html(<KpiPlanFactTable data={{ year: 2026, month: 9, metrics: [], rows: [] }} />);

    expect(out).toContain('Показатели не выбраны');
    expect(out).toContain('Показатели и планы');
  });

  it('показатели есть, а строк нет — тот же пустой экран', () => {
    const out = html(
      <KpiPlanFactTable
        data={{
          year: 2026,
          month: 9,
          metrics: [{ key: 'deals', label: 'Сделки', unit: 'count', perManager: true }],
          rows: [],
        }}
      />
    );

    expect(out).toContain('Показатели не выбраны');
  });

  it('деньги, минуты и штуки печатаются по-своему', () => {
    const out = html(
      <KpiPlanFactTable
        data={{
          year: 2026,
          month: 9,
          metrics: [
            { key: 'revenue', label: 'Выручка', unit: 'money', perManager: false },
            { key: 'response', label: 'Ответ', unit: 'minutes', perManager: false },
            { key: 'deals', label: 'Сделки', unit: 'count', perManager: false },
          ],
          rows: [
            row({ metric: 'revenue', unit: 'money', plan: '100000', fact: '50000' }),
            row({ metric: 'response', unit: 'minutes', plan: '30', fact: '20' }),
            row({ metric: 'deals', unit: 'count' }),
          ],
        }}
      />
    );

    expect(out).toContain('₽');
    expect(out).toContain('мин');
    expect(out).toContain('50 %');
  });

  it('плана нет — так и написано, а вместо процента прочерк', () => {
    const out = html(
      <KpiPlanFactTable
        data={{
          year: 2026,
          month: 9,
          metrics: [{ key: 'deals', label: 'Сделки', unit: 'count', perManager: true }],
          rows: [row({ plan: null, percent: null })],
        }}
      />
    );

    expect(out).toContain('план не задан');
    expect(out).not.toContain('0 %');
  });

  it.each([
    ['5', '0', '—', 'прошлого месяца не было — сравнивать не с чем'],
    ['5', '5', 'как в прошлом месяце', 'ровно столько же'],
    ['10', '5', '+100 % к прошлому', 'рост'],
    ['4', '5', '-20 % к прошлому', 'падение'],
    ['не число', '5', '—', 'мусор вместо числа не превращается в NaN на экране'],
  ])('динамика: факт %s против %s даёт «%s» (%s)', (fact, prevFact, expected) => {
    const out = html(
      <KpiPlanFactTable
        data={{
          year: 2026,
          month: 9,
          metrics: [{ key: 'deals', label: 'Сделки', unit: 'count', perManager: true }],
          rows: [row({ fact, prevFact })],
        }}
      />
    );

    expect(out).toContain(expected);
  });

  it('строка итога выделяется и не притворяется человеком', () => {
    const out = html(
      <KpiPlanFactTable
        data={{
          year: 2026,
          month: 9,
          metrics: [{ key: 'deals', label: 'Сделки', unit: 'count', perManager: true }],
          rows: [
            row({}),
            row({ managerId: null, managerName: 'Итого по команде', prevFact: 'мусор' }),
          ],
        }}
      />
    );

    expect(out).toContain('kpi-row-deals-total');
    expect(out).toContain('font-medium');
    expect(out).toContain('Итого по команде');
    // Испорченный прошлый месяц не превращается в «NaN %».
    expect(out).not.toContain('NaN');
  });
});

describe('SourcesPanel — откуда приходят клиенты', () => {
  it('ни лидов, ни обращений — пустой экран с подсказкой', () => {
    const out = html(
      <SourcesPanel
        data={{
          leads: [],
          requests: [],
          totalLeads: 0,
          totalDeals: 0,
          totalOrders: 0,
        }}
      />
    );

    expect(out).toContain('новых лидов и обращений не было');
    expect(out).toContain('Выберите другой месяц');
  });

  it('лиды есть, обращений нет — вторая половина честно говорит «не было»', () => {
    const out = html(
      <SourcesPanel
        data={{
          leads: [
            { source: 'site', label: 'Сайт', leads: 10, deals: 4, orders: 2, conversionPct: 20 },
            { source: 'call', label: 'Звонок', leads: 1, deals: 0, orders: 0, conversionPct: null },
          ],
          requests: [],
          totalLeads: 11,
          totalDeals: 4,
          totalOrders: 2,
        }}
      />
    );

    expect(out).toContain('Сайт');
    expect(out).toContain('20 %');
    expect(out).toContain('Обращений за период не было');
    // 2 из 11 — 18 %.
    expect(out).toContain('(18 %)');
  });

  it('обращения есть, лидов нет — процент не считается от нуля', () => {
    const out = html(
      <SourcesPanel
        data={{
          leads: [],
          requests: [{ source: 'organization', label: 'Кабинет заказчика', requests: 3 }],
          totalLeads: 0,
          totalDeals: 0,
          totalOrders: 0,
        }}
      />
    );

    expect(out).toContain('Кабинет заказчика');
    expect(out).toContain('Новых лидов за период не было');
    expect(out).not.toContain('%)');
  });
});

describe('PartnersAnalyticsPanel — партнёры', () => {
  it('партнёров нет — экран объясняет, когда они появятся', () => {
    const out = html(
      <PartnersAnalyticsPanel data={{ rows: [], totalAccrued: '0', totalPaid: '0' }} />
    );

    expect(out).toContain('Партнёров у компании пока нет');
    expect(out).toContain('закреплена хотя бы одна организация');
  });

  it('строки печатаются и таблицей, и карточками — телефон не остаётся без данных', () => {
    const out = html(
      <PartnersAnalyticsPanel
        data={{
          rows: [
            {
              partnerId: 'p1',
              partnerName: 'ООО «Партнёр»',
              organizations: 2,
              accrued: '1000',
              paid: '400',
              requests: 5,
            },
          ],
          totalAccrued: '1000',
          totalPaid: '400',
        }}
      />
    );

    expect(out).toContain('/admin/partners/p1');
    expect(out).toContain('Черновики актов в начисление не входят');
    // Имя партнёра встречается дважды: в таблице и в карточке.
    expect(out.split('ООО «Партнёр»').length - 1).toBe(2);
  });
});

describe('CommunicationsPanel — как быстро отвечаем', () => {
  const calls = { inbound: 0, answered: 0, missed: 0, outbound: 0 };

  it('ни переписки, ни звонков — пустой экран', () => {
    const out = html(
      <CommunicationsPanel data={{ byChannel: [], byManager: [], calls, slaHours: 4 }} />
    );

    expect(out).toContain('переписки и звонков не было');
  });

  it('звонки есть, переписки нет — таблицы нет, но экран не пустой', () => {
    const out = html(
      <CommunicationsPanel
        data={{
          byChannel: [],
          byManager: [],
          calls: { inbound: 3, answered: 2, missed: 1, outbound: 4 },
          slaHours: 4,
        }}
      />
    );

    expect(out).toContain('Переписки за период не было');
    expect(out).toContain('пропустили: 1');
  });

  it.each([
    [null, '—'],
    [45, '45 мин'],
    [120, '2 ч'],
    [135, '2 ч 15 мин'],
  ])('первый ответ %s печатается как «%s»', (min, expected) => {
    const out = html(
      <CommunicationsPanel
        data={{
          byChannel: [
            {
              channel: 'email',
              channelLabel: 'Почта',
              dialogs: 1,
              answered: 1,
              avgFirstResponseMin: min,
              overSla: 0,
              waitingNoAnswer: 0,
            },
          ],
          byManager: [],
          calls,
          slaHours: 4,
        }}
      />
    );

    expect(out).toContain(expected);
  });

  it('просрочки и безответные подсвечиваются красным, сотрудники перечисляются', () => {
    const out = html(
      <CommunicationsPanel
        data={{
          byChannel: [
            {
              channel: 'email',
              channelLabel: 'Почта',
              dialogs: 5,
              answered: 3,
              avgFirstResponseMin: 30,
              overSla: 2,
              waitingNoAnswer: 1,
            },
          ],
          byManager: [
            {
              managerId: 'm1',
              managerName: 'Иванов',
              dialogs: 4,
              avgFirstResponseMin: 30,
              overSla: 2,
            },
            {
              managerId: null,
              managerName: 'Без ответственного',
              dialogs: 1,
              avgFirstResponseMin: null,
              overSla: 0,
            },
          ],
          calls,
          slaHours: 4,
        }}
      />
    );

    expect(out).toContain('text-red-700');
    expect(out).toContain('просрочек: 2');
    expect(out).toContain('Без ответственного');
    expect(out).toContain('истории назначений система не хранит');
  });
});

describe('ReceivablesPanel — дебиторка', () => {
  const base = '/leader/analytics';

  it('долгов нет — так и написано', () => {
    const out = html(
      <ReceivablesPanel
        data={{ rows: [], totalDebt: '0', olderThanDays: 0 }}
        basePath={base}
        query={undefined}
      />
    );

    expect(out).toContain('Долгов нет');
    expect(out).toContain('Все выставленные счета оплачены');
  });

  it('под фильтром пусто — предлагает снять фильтр, а не молчит', () => {
    const out = html(
      <ReceivablesPanel
        data={{ rows: [], totalDebt: '0', olderThanDays: 60 }}
        basePath={base}
        query={{ month: '2026-09' }}
      />
    );

    expect(out).toContain('Долгов старше срока нет');
    expect(out).toContain('снять фильтр');
    expect(out).toContain('month=2026-09');
    expect(out).toContain('older=60');
  });

  it('строки печатаются, пустой срок и пустой ответственный дают прочерк', () => {
    const out = html(
      <ReceivablesPanel
        data={{
          rows: [
            {
              organizationId: 'o1',
              organizationName: 'ООО «Ромашка»',
              billed: '1000',
              paid: '400',
              debt: '600',
              oldestDays: 45,
              managerName: 'Иванов',
            },
            {
              organizationId: 'o2',
              organizationName: 'ООО «Второе»',
              billed: '500',
              paid: '0',
              debt: '500',
              oldestDays: null,
              managerName: null,
            },
          ],
          totalDebt: '1100',
          olderThanDays: 0,
        }}
        basePath={base}
      />
    );

    expect(out).toContain('/manager/organizations/o1');
    expect(out).toContain('45 дн.');
    expect(out).toContain('—');
    expect(out).toContain('Всего долг');
  });
});
