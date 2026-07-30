import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, className, 'data-testid': testId, 'data-active': dataActive }: {
    href: string; children: React.ReactNode; className?: string; 'data-testid'?: string; 'data-active'?: boolean;
  }) => React.createElement('a', { href, className, 'data-testid': testId, 'data-active': dataActive }, children)
}));

import { OrgCardTabs, ORG_CARD_TABS } from '@/components/manager/org-card-tabs';
import type { OrganizationCard } from '@/lib/services/manager/organizationCard';

function makeCard(overrides: Partial<OrganizationCard>): OrganizationCard {
  return {
    name: 'ООО Ромашка',
    partner: { name: 'Партнёр Иванов' },
    inn: '1234567890',
    kpp: '987654321',
    commission: null,
    counts: { orders: 3, students: 5, users: 2 },
    kpis: { activeOrders: 2, totalPaid: '100.00' },
    orders: [],
    documents: [],
    payments: [],
    activity: [],
    inboundMessages: [],
    calls: [],
    // Этап 8 (PR-1): полный набор реквизитов read-only таба.
    requisites: {
      legalName: null, ogrn: null, legalAddress: null, bankName: null, bankAccount: null,
      corrAccount: null, bic: null, signerName: null, signerPosition: null, signerBasis: null
    },
    ...overrides
  } as unknown as OrganizationCard;
}

describe('OrgCardTabs — header + nav', () => {
  it('renders org name and partner name', () => {
    const card = makeCard({});
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'history' }));
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('Партнёр Иванов');
  });

  it('omits the partner line when partner is null', () => {
    const card = makeCard({ partner: null });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'history' }));
    expect(html).not.toContain('Партнёр:');
  });

  it('renders all KPI tiles', () => {
    const card = makeCard({});
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'history' }));
    expect(html).toContain('Заявки');
    expect(html).toContain('Активные');
    expect(html).toContain('Сотрудники');
    expect(html).toContain('Пользователи');
    expect(html).toContain('Оплачено');
  });

  it('renders a nav link for every tab and marks the active one', () => {
    const card = makeCard({});
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'orders' }));
    for (const t of ORG_CARD_TABS) {
      expect(html).toContain(`data-testid="org-tab-${t.key}"`);
    }
    expect(html).toContain('data-testid="org-tab-orders" data-active="true"');
    expect(html).toContain('data-testid="org-tab-history" data-active="false"');
  });
});

describe('OrgCardTabs — orders section', () => {
  it('empty: renders EmptyState', () => {
    const card = makeCard({ orders: [] });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'orders' }));
    expect(html).toContain('Заявок пока нет');
  });

  it('non-empty: renders order row with number, title, statuses, amounts', () => {
    const card = makeCard({
      orders: [
        {
          id: 'o1',
          orderNumber: 'A-1',
          title: 'Заказ X',
          executionStatus: 'in_progress',
          financialStatus: 'billed',
          totalAmount: '1000.00',
          paidAmount: '500.00',
          createdAt: new Date('2026-01-01')
        }
      ]
    });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'orders' }));
    expect(html).toContain('A-1');
    expect(html).toContain('Заказ X');
    expect(html).toContain('in_progress');
    expect(html).toContain('billed');
    expect(html).toContain('1000.00 ₽');
    expect(html).toContain('500.00 ₽');
  });

  it('renders — for missing orderNumber', () => {
    const card = makeCard({
      orders: [
        {
          id: 'o1',
          orderNumber: null,
          title: 'Заказ X',
          executionStatus: 'pending',
          financialStatus: 'not_billed',
          totalAmount: '0.00',
          paidAmount: '0.00',
          createdAt: new Date('2026-01-01')
        }
      ]
    });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'orders' }));
    expect(html).toContain('—');
  });
});

describe('OrgCardTabs — documents section', () => {
  it('empty: renders EmptyState', () => {
    const card = makeCard({ documents: [] });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'documents' }));
    expect(html).toContain('Документов пока нет');
  });

  it('non-empty: renders document row with name, type, direction, date', () => {
    const card = makeCard({
      documents: [
        { id: 'd1', name: 'Договор.pdf', type: 'contract', direction: 'to_organization', createdAt: new Date('2026-02-01') }
      ]
    });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'documents' }));
    expect(html).toContain('Договор.pdf');
    expect(html).toContain('contract');
    expect(html).toContain('to_organization');
  });
});

describe('OrgCardTabs — payments section', () => {
  it('renders kpi tiles for totalPaid/totalRefunded even when empty', () => {
    const card = makeCard({ payments: [], kpis: { activeOrders: 0, totalPaid: '0.00', totalRefunded: '0.00' } as never });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'payments' }));
    expect(html).toContain('Оплачено (нетто)');
    expect(html).toContain('Возвраты');
    expect(html).toContain('Оплат пока нет');
  });

  it('non-empty: renders a regular payment row with success badge', () => {
    const card = makeCard({
      payments: [{ id: 'p1', paidAt: new Date('2026-03-01'), amount: '100.00', isRefund: false, orderId: 'o1' }]
    });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'payments' }));
    expect(html).toContain('100.00 ₽');
    expect(html).toContain('Оплата');
  });

  it('non-empty: renders a refund payment row with danger badge', () => {
    const card = makeCard({
      payments: [{ id: 'p1', paidAt: new Date('2026-03-01'), amount: '50.00', isRefund: true, orderId: 'o1' }]
    });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'payments' }));
    expect(html).toContain('Возврат');
  });
});

describe('OrgCardTabs — threads section', () => {
  it('empty: renders EmptyState', () => {
    const card = makeCard({ activity: [] });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'threads' }));
    expect(html).toContain('Переписки пока нет');
  });

  it('non-empty: renders author, date, body', () => {
    const card = makeCard({
      activity: [{ id: 'c1', authorName: 'Иван', createdAt: new Date('2026-04-01'), body: 'Комментарий тест', orderId: 'o1' }]
    });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'threads' }));
    expect(html).toContain('Иван');
    expect(html).toContain('Комментарий тест');
  });
});

describe('OrgCardTabs — details section', () => {
  it('renders name, partner, inn, kpp when present', () => {
    const card = makeCard({ partner: { id: 'p1', name: 'Партнёр Х' }, inn: '111', kpp: '222' });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'details' }));
    expect(html).toContain('Название');
    expect(html).toContain('Партнёр Х');
    expect(html).toContain('111');
    expect(html).toContain('222');
  });

  it('renders — fallbacks when partner/inn/kpp are missing', () => {
    const card = makeCard({ partner: null, inn: null, kpp: null });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'details' }));
    expect(html).toContain('—');
  });

  it('подписант: должность добавляется через запятую, без неё — только ФИО', () => {
    // Подписант уходит в шапку документов. Если должности нет, в строке не
    // должно оставаться висящей запятой.
    const withPosition = makeCard({
      requisites: { signerName: 'Иванов И.И.', signerPosition: 'Директор' }
    } as never);
    expect(
      renderToString(React.createElement(OrgCardTabs, { card: withPosition, activeTab: 'details' }))
    ).toContain('Иванов И.И., Директор');

    const withoutPosition = makeCard({
      requisites: { signerName: 'Иванов И.И.', signerPosition: null }
    } as never);
    const html = renderToString(
      React.createElement(OrgCardTabs, { card: withoutPosition, activeTab: 'details' })
    );
    expect(html).toContain('Иванов И.И.');
    expect(html).not.toContain('Иванов И.И.,');
  });

  it('renders commission rate detail when card.commission is present', () => {
    const card = makeCard({ commission: { partnerCommissionRate: '10%' } as never });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'details' }));
    expect(html).toContain('Ставка комиссии партнёра');
    expect(html).toContain('10%');
  });

  it('renders — for the commission rate when card.commission.partnerCommissionRate is null', () => {
    const card = makeCard({ commission: { partnerCommissionRate: null } as never });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'details' }));
    expect(html).toContain('Ставка комиссии партнёра');
    expect(html).toContain('—');
  });

  it('omits the commission detail row when card.commission is null', () => {
    const card = makeCard({ commission: null });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'details' }));
    expect(html).not.toContain('Ставка комиссии партнёра');
  });
});

describe('OrgCardTabs — history section (default tab)', () => {
  it('all empty: renders the top-level EmptyState', () => {
    const card = makeCard({ orders: [], payments: [], activity: [] });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'history' }));
    expect(html).toContain('Истории пока нет');
  });

  it('with orders/payments/activity: renders mini-panels with rows (regular + refund payments)', () => {
    const card = makeCard({
      orders: [{ id: 'o1', title: 'Заказ 1', createdAt: new Date('2026-01-05') } as never],
      payments: [
        { id: 'p1', amount: '100.00', paidAt: new Date('2026-01-07'), isRefund: false } as never,
        { id: 'p2', amount: '20.00', paidAt: new Date('2026-01-08'), isRefund: true } as never
      ],
      activity: [{ id: 'c1', authorName: 'X', createdAt: new Date('2026-01-06'), body: 'привет мир как дела сегодня действительно длинный текст' } as never]
    });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'history' }));
    expect(html).toContain('Последние заявки');
    expect(html).toContain('Заказ 1');
    expect(html).toContain('Последние оплаты');
    expect(html).toContain('100.00 ₽');
    expect(html).toContain('− 20.00 ₽');
    expect(html).toContain('Последняя переписка');
  });

  it('empty orders/payments/activity individually: each mini-panel renders its own dash', () => {
    const card = makeCard({
      orders: [],
      payments: [],
      activity: [{ id: 'c1', authorName: 'X', createdAt: new Date('2026-01-06'), body: 'непусто' } as never]
    });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'history' }));
    const dashCount = (html.match(/text-xs text-gray-400">—</g) ?? []).length;
    expect(dashCount).toBe(2);
  });

  it('falls through to history when an unknown/undefined tab value is passed', () => {
    const card = makeCard({ orders: [], payments: [], activity: [] });
    const html = renderToString(
      React.createElement(OrgCardTabs, { card, activeTab: 'nonsense' as never })
    );
    expect(html).toContain('Истории пока нет');
  });
});

describe('OrgCardTabs — calls tab (G4)', () => {
  it('renders the read-only CallsList (empty state)', () => {
    const card = makeCard({ calls: [] });
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'calls' }));
    expect(html).toContain('Звонков нет');
  });
});

describe('OrgCardTabs — inbound messages tab (G4, read-only)', () => {
  it('empty: renders EmptyState', () => {
    const card = makeCard({ inboundMessages: [] });
    const html = renderToString(
      React.createElement(OrgCardTabs, { card, activeTab: 'inbound_messages' })
    );
    expect(html).toContain('Обращений нет');
  });

  it('renders a full row: channel/status labels, sender, subject, excerpt, attachment', () => {
    const card = makeCard({
      inboundMessages: [
        {
          id: 'im1',
          channel: 'telegram',
          senderRef: '@ref',
          senderDisplay: 'Отправитель',
          subject: 'Тема письма',
          body: 'б'.repeat(200),
          createdAt: new Date('2026-07-01'),
          status: 'bound',
          scanStatus: 'clean',
          attachmentName: 'скан.pdf'
        }
      ]
    });
    const html = renderToString(
      React.createElement(OrgCardTabs, { card, activeTab: 'inbound_messages' })
    );
    expect(html).toContain('Telegram');
    expect(html).toContain('Привязано');
    expect(html).toContain('Отправитель');
    expect(html).toContain('Тема письма');
    expect(html).toContain('…'); // excerpt длинного body
    expect(html).toContain('скан.pdf');
  });

  it('falls back for unknown channel/status and senderRef when display is null', () => {
    const card = makeCard({
      inboundMessages: [
        {
          id: 'im2',
          channel: 'pigeon',
          senderRef: '@fallback',
          senderDisplay: null,
          subject: null,
          body: 'коротко',
          createdAt: new Date('2026-07-02'),
          status: 'strange',
          scanStatus: 'none',
          attachmentName: null
        }
      ]
    });
    const html = renderToString(
      React.createElement(OrgCardTabs, { card, activeTab: 'inbound_messages' })
    );
    expect(html).toContain('pigeon');
    expect(html).toContain('strange');
    expect(html).toContain('@fallback');
    expect(html).toContain('коротко');
    expect(html).not.toContain('📎');
  });
});

// Этап 7 (PR-3) — вкладки внутреннего контура: Заявки клиентов / Лиды / Сделки.
describe('вкладки внутреннего контура (этап 7 PR-3)', () => {
  const internal = {
    clientRequests: [
      { id: 'r1', subject: 'Обучение по ОТ', status: 'rejected', rejectedReason: 'Дубль', createdAt: new Date('2026-07-01') }
    ],
    leads: [{ id: 'l1', subject: 'Лид-тема', status: 'new', createdAt: new Date('2026-07-02') }],
    deals: [
      { id: 'd1', title: 'Сделка-1', status: 'won', amount: '1500.00', createdAt: new Date('2026-07-03') },
      { id: 'd2', title: 'Сделка-2', status: 'open', amount: null, createdAt: new Date('2026-07-04') }
    ]
  };

  it('канон табов содержит три новых ключа', () => {
    const keys = ORG_CARD_TABS.map((t) => t.key);
    expect(keys).toContain('client_requests');
    expect(keys).toContain('leads');
    expect(keys).toContain('deals');
  });

  it('заявки клиентов: тема, русский статус, причина отклонения', () => {
    const html = renderToString(
      React.createElement(OrgCardTabs, { card: makeCard(internal as never), activeTab: 'client_requests' })
    );
    expect(html).toContain('Обучение по ОТ');
    expect(html).toContain('Дубль');
    expect(html).toContain('Отклонена');
  });

  it('лиды: ссылка на карточку лида + статус-бейдж', () => {
    const html = renderToString(React.createElement(OrgCardTabs, { card: makeCard(internal as never), activeTab: 'leads' }));
    expect(html).toContain('/manager/leads/l1');
    expect(html).toContain('Лид-тема');
  });

  it('сделки: русские статусы и сумма с прочерком для null', () => {
    const html = renderToString(React.createElement(OrgCardTabs, { card: makeCard(internal as never), activeTab: 'deals' }));
    expect(html).toContain('Сделка-1');
    expect(html).toContain('Выиграна');
    expect(html).toContain('В работе');
    expect(html).toContain('1500.00');
    expect(html).toContain('—');
  });

  it('незнакомый статус сделки показывается как есть, нейтральным бейджем', () => {
    // Набор статусов сделок расширяем — карточка обязана показать сырое значение,
    // а не пустой бейдж: иначе менеджер не поймёт, в каком состоянии сделка.
    const odd = {
      ...internal,
      deals: [{ id: 'd9', title: 'Сделка-9', status: 'frozen', amount: null, createdAt: new Date('2026-07-05') }]
    };
    const html = renderToString(
      React.createElement(OrgCardTabs, { card: makeCard(odd as never), activeTab: 'deals' })
    );
    expect(html).toContain('Сделка-9');
    expect(html).toContain('frozen');
  });

  it('пустые состояния трёх вкладок', () => {
    const empty = makeCard({ clientRequests: [], leads: [], deals: [] } as never);
    expect(renderToString(React.createElement(OrgCardTabs, { card: empty, activeTab: 'client_requests' }))).toContain('Заявок клиентов пока нет.');
    expect(renderToString(React.createElement(OrgCardTabs, { card: empty, activeTab: 'leads' }))).toContain('Лидов пока нет.');
    expect(renderToString(React.createElement(OrgCardTabs, { card: empty, activeTab: 'deals' }))).toContain('Сделок пока нет.');
  });
});

// ─── Этап 9 PR-3 (ФТ-12.2): вкладка «Удостоверения» + кнопки выгрузок ─────────

describe('OrgCardTabs — вкладка «Удостоверения» и выгрузки', () => {
  const CERT = {
    id: 'c1',
    number: 'УД-77',
    studentName: 'Иванов Иван',
    directionName: 'Охрана труда',
    issuedAt: new Date('2026-01-15'),
    validUntil: new Date('2029-01-15'),
    hasScan: true
  };

  it('вкладка есть в списке табов', () => {
    expect(ORG_CARD_TABS.map((t) => t.key)).toContain('certificates');
    expect(ORG_CARD_TABS.find((t) => t.key === 'certificates')?.label).toBe('Удостоверения');
  });

  it('таблица удостоверений и ссылка на выгрузку', () => {
    const card = makeCard({ id: 'org1', certificates: [CERT] } as never);
    const html = renderToString(
      React.createElement(OrgCardTabs, { card, activeTab: 'certificates' })
    );
    expect(html).toContain('УД-77');
    expect(html).toContain('Иванов Иван');
    expect(html).toContain('Охрана труда');
    expect(html).toContain('15.01.2029');
    expect(html).toContain('/api/manager/organizations/org1/certificates/export');
    expect(html).toContain('Выгрузить в Excel');
  });

  it('бессрочное удостоверение и отсутствующий скан подписаны словами', () => {
    const card = makeCard({
      id: 'org1',
      certificates: [{ ...CERT, validUntil: null, hasScan: false }]
    } as never);
    const html = renderToString(
      React.createElement(OrgCardTabs, { card, activeTab: 'certificates' })
    );
    expect(html).toContain('бессрочно');
    expect(html).toContain('готовится');
  });

  it('пустой реестр: пустое состояние, но кнопка выгрузки остаётся', () => {
    const card = makeCard({ id: 'org1', certificates: [] } as never);
    const html = renderToString(
      React.createElement(OrgCardTabs, { card, activeTab: 'certificates' })
    );
    expect(html).toContain('Удостоверений пока нет.');
    expect(html).toContain('/api/manager/organizations/org1/certificates/export');
  });

  it('вкладка «Оплаты» несёт свою выгрузку', () => {
    const card = makeCard({ id: 'org1', payments: [] } as never);
    const html = renderToString(React.createElement(OrgCardTabs, { card, activeTab: 'payments' }));
    expect(html).toContain('/api/manager/organizations/org1/payments/export');
  });
});
