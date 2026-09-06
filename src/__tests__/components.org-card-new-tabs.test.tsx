import React from 'react';
import { describe, it, expect } from 'vitest';
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
    counts: { orders: 0, students: 0, cabinetUsers: 0 },
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
    auditTrail: [],
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
      auditTrail: 0,
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

describe('вкладка «История» — журнал действий (У-96)', () => {
  it('показывает действие по-русски, а не машинным кодом', () => {
    const html = render('history', {
      auditTrail: [
        {
          id: 'a1',
          action: 'organization_egrul_filled',
          createdAt: new Date('2026-03-01'),
          actorName: 'Иванов',
        },
      ],
    });
    expect(html).toContain('Заполнение реквизитов из ЕГРЮЛ');
    expect(html).toContain('Иванов');
    expect(html).not.toContain('organization_egrul_filled');
  });

  it('автор неизвестен — прочерк, а не пустая ячейка', () => {
    const html = render('history', {
      auditTrail: [
        { id: 'a1', action: 'organization_updated', createdAt: new Date(), actorName: null },
      ],
    });
    expect(html).toContain('—');
  });

  it('пусто — объясняет себя (У-74)', () => {
    expect(render('history')).toContain('Изменений по этой организации ещё не было');
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
