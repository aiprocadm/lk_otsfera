import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderToString } from 'react-dom/server';
import { OrgCardTabs } from '@/components/manager/org-card-tabs';
import type { OrganizationCard } from '@/lib/services/manager/organizationCard';

/**
 * `У-96`: три вкладки, которых в карточке не было.
 *
 * «Обзор» раньше назывался «Историей» — из-за этого настоящего журнала
 * действий (кто и что менял) в карточке не существовало вовсе, а «История» на
 * него не отвечала. «Заявки на обучение» жили только в своём разделе и рядом с
 * клиентом не показывались.
 */
const TABS = [
  { key: 'overview' as const, label: 'Обзор' },
  { key: 'enrollments' as const, label: 'Заявки на обучение' },
  { key: 'history' as const, label: 'История' },
];

function card(over: Partial<OrganizationCard> = {}): OrganizationCard {
  return {
    id: 'org-1',
    name: 'ООО «Ромашка»',
    inn: '7707083893',
    kpp: null,
    requisites: {
      legalName: null,
      ogrn: null,
      legalAddress: null,
      bankName: null,
      bankAccount: null,
      corrAccount: null,
      bic: null,
      signerName: null,
      signerPosition: null,
      signerBasis: null,
    },
    partner: null,
    counts: { orders: 0, students: 0, cabinetUsers: 0, contacts: 0 },
    kpis: { activeOrders: 0, totalPaid: '0', totalRefunded: '0', debt: '0' },
    orders: [],
    documents: [],
    payments: [],
    activity: [],
    inboundMessages: [],
    calls: [],
    clientRequests: [],
    leads: [],
    deals: [],
    certificates: [],
    enrollments: [],
    tabTotals: {
      orders: 0,
      documents: 0,
      payments: 0,
      activity: 0,
      inboundMessages: 0,
      calls: 0,
      clientRequests: 0,
      leads: 0,
      deals: 0,
      certificates: 0,
      enrollments: 0,
    },
    commission: null,
    ...over,
  } as OrganizationCard;
}

const render = (
  activeTab: 'overview' | 'enrollments' | 'history',
  over: Partial<OrganizationCard> = {}
) => renderToString(<OrgCardTabs card={card(over)} activeTab={activeTab} tabs={TABS} />);

describe('вкладка «Заявки на обучение» (У-96)', () => {
  it('показывает обучение, число слушателей и статус по-русски', () => {
    const html = render('enrollments', {
      enrollments: [
        {
          id: 'e1',
          status: 'pending',
          createdAt: new Date('2026-02-01'),
          courseTitle: 'Электробезопасность',
          studentsCount: 7,
        },
      ],
    });
    expect(html).toContain('Электробезопасность');
    expect(html).toContain('7');
    expect(html).not.toContain('pending');
  });

  it('заявка без названия обучения не оставляет пустую ячейку', () => {
    const html = render('enrollments', {
      enrollments: [
        {
          id: 'e1',
          status: 'pending',
          createdAt: new Date('2026-02-01'),
          courseTitle: null,
          studentsCount: 1,
        },
      ],
    });
    expect(html).toContain('Без названия');
  });

  it('пусто — объясняет себя (У-74)', () => {
    expect(render('enrollments')).toContain('Заявок на обучение пока нет');
  });
});

describe('вкладка «История» — единая лента (У-184)', () => {
  // `У-184` (этап 1 ТЗ 12.09.2026): ленту собирает `orgHistory.ts`, а карточка
  // получает готовый узел от страницы — как «Сотрудники». Без узла вкладка пуста
  // (страница не передала — значит, не открыта).
  it('показывает переданный узел ленты', () => {
    const html = renderToStaticMarkup(
      <OrgCardTabs
        card={card({})}
        activeTab="history"
        tabs={TABS}
        history={<div data-testid="history">ЛЕНТА</div>}
      />
    );
    expect(html).toContain('ЛЕНТА');
  });

  it('без узла ничего не рисует и не падает', () => {
    expect(render('history')).not.toContain('ЛЕНТА');
  });
});

describe('вкладки «Контакты» и «Заметки» (У-182, У-183) и «Важное» на «Обзоре»', () => {
  it('узлы контактов и заметок рисуются на своих вкладках', () => {
    const contacts = renderToStaticMarkup(
      <OrgCardTabs
        card={card({})}
        activeTab="contacts"
        tabs={TABS}
        contacts={<div>СПИСОК-КОНТАКТОВ</div>}
      />
    );
    expect(contacts).toContain('СПИСОК-КОНТАКТОВ');
    const notes = renderToStaticMarkup(
      <OrgCardTabs card={card({})} activeTab="notes" tabs={TABS} notes={<div>ЗАМЕТКИ</div>} />
    );
    expect(notes).toContain('ЗАМЕТКИ');
  });

  it('«Важное» показывается над сводкой «Обзора»', () => {
    const html = renderToStaticMarkup(
      <OrgCardTabs
        card={card({})}
        activeTab="overview"
        tabs={TABS}
        overviewExtra={<div>ВАЖНОЕ</div>}
      />
    );
    expect(html.indexOf('ВАЖНОЕ')).toBeGreaterThan(-1);
    expect(html.indexOf('ВАЖНОЕ')).toBeLessThan(
      html.indexOf('Работа с этим клиентом ещё не начиналась')
    );
  });

  it('плитка «Контакты» — только когда есть вкладка «Контакты»', () => {
    const withTab = renderToStaticMarkup(
      <OrgCardTabs
        card={card({ counts: { orders: 0, students: 0, cabinetUsers: 0, contacts: 4 } })}
        activeTab="overview"
        tabs={[...TABS, { key: 'contacts', label: 'Контакты' }]}
      />
    );
    expect(withTab).toContain('Контакты');
    const withoutTab = renderToStaticMarkup(
      <OrgCardTabs
        card={card({ counts: { orders: 0, students: 0, cabinetUsers: 0, contacts: 4 } })}
        activeTab="overview"
        tabs={TABS}
      />
    );
    expect(withoutTab).not.toContain('>Контакты<');
  });
});

describe('вкладка «Обзор» (У-96)', () => {
  it('пустой клиент объясняет, что работа ещё не начиналась', () => {
    expect(render('overview')).toContain('Работа с этим клиентом ещё не начиналась');
  });

  it('сводка показывает последние заказы, оплаты и комментарии', () => {
    const html = render('overview', {
      orders: [
        {
          id: 'o1',
          orderNumber: '1',
          title: 'Заказ 1',
          executionStatus: 'pending',
          financialStatus: 'unpaid',
          totalAmount: '100.00',
          paidAmount: '0.00',
          createdAt: new Date('2026-01-05'),
        },
      ],
      payments: [
        {
          id: 'p1',
          amount: '100.00',
          paidAt: new Date('2026-01-07'),
          isRefund: false,
          orderId: 'o1',
        },
      ],
      activity: [
        {
          id: 'c1',
          body: 'Договорились о датах',
          createdAt: new Date('2026-01-06'),
          authorName: 'Пётр',
          orderId: 'o1',
        },
      ],
    });
    expect(html).toContain('Заказ 1');
    expect(html).toContain('Последние комментарии');
  });

  it('неизвестная вкладка падает на «Обзор», а не на пустоту', () => {
    // Ключ из адреса страницы отфильтрован реестром, но ветка `default` —
    // последний рубеж: пустой экран без объяснения был бы дефектом (`У-74`).
    const html = renderToString(
      <OrgCardTabs card={card()} activeTab={'нет-такой' as never} tabs={TABS} />
    );
    expect(html).toContain('Работа с этим клиентом ещё не начиналась');
  });
});
