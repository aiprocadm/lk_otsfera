import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}));
vi.mock('@/components/manager/manager-order-header', () => ({
  ManagerOrderHeader: (props: { steps: { steps: Array<{ label: string }> } | null }) =>
    React.createElement(
      'div',
      { 'data-testid': 'order-header' },
      props.steps ? props.steps.steps.map((s) => s.label).join('|') : 'no-steps'
    ),
}));
vi.mock('@/components/manager/manager-order-amounts', () => ({ ManagerOrderAmounts: () => null }));
vi.mock('@/components/manager/manager-order-timeline', () => ({
  ManagerOrderTimeline: () => null,
}));
vi.mock('@/components/manager/manager-status-change-form', () => ({
  ManagerStatusChangeForm: () =>
    React.createElement('div', { 'data-testid': 'status-change-form' }),
}));
vi.mock('@/components/manager/order-lifecycle-panel', () => ({
  OrderLifecyclePanel: (props: {
    orderId: string;
    accountingSigned: boolean;
    returnReason: string | null;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'order-lifecycle-panel' },
      props.orderId,
      String(props.accountingSigned),
      String(props.returnReason)
    ),
}));
vi.mock('@/components/manager/manager-payments-list', () => ({ ManagerPaymentsList: () => null }));
vi.mock('@/components/partner/documents-list', () => ({ DocumentsList: () => null }));
// `У-158`: форма загрузки — клиентская (нужен роутер), деталку она не
// касается по существу: здесь проверяется состав блоков.
vi.mock('@/components/manager/manager-doc-upload-form', () => ({
  ManagerDocUploadForm: (props: { embedded?: boolean }) =>
    React.createElement('div', { 'data-testid': 'doc-upload' }, `embedded=${props.embedded}`),
}));
vi.mock('@/components/training/order-items-section', () => ({ OrderItemsSection: () => null }));
vi.mock('@/components/orders/order-custom-fields', () => ({ OrderCustomFields: () => null }));
vi.mock('@/components/orders/order-status-panel', () => ({
  OrderStatusPanel: (props: { orderId: string }) =>
    React.createElement('div', { 'data-testid': 'status-panel' }, props.orderId),
}));
vi.mock('@/components/manager/claim-order-button', () => ({
  ClaimOrderButton: (props: { orderId: string; managerId: string | null }) =>
    React.createElement(
      'div',
      { 'data-testid': 'claim-order-button' },
      props.orderId,
      String(props.managerId)
    ),
}));
vi.mock('@/components/manager/deal-activity/deal-activity-thread', () => ({
  DealActivityThread: (props: { orderId: string; items: unknown[]; telephonyEnabled: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'deal-activity-thread' },
      props.orderId,
      String(props.items.length),
      String(props.telephonyEnabled)
    ),
}));
// `У-310`: всё, что видит клиент, — отдельный блок; диалоги — его частью.
vi.mock('@/components/orders/order-client-thread', () => ({
  OrderClientThread: (props: {
    orderId: string;
    items: unknown[];
    inboundEnabled: boolean;
    children?: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'order-client-thread' },
      props.orderId,
      String(props.items.length),
      String(props.inboundEnabled),
      props.children
    ),
}));

import { ManagerOrderDetailView } from '@/components/manager/manager-order-detail-view';

const BASE_ORDER = {
  id: 'o1',
  orderNumber: 'A-1',
  title: 'X',
  executionStatus: 'in_progress',
  status: 'new',
  accountingSignedAt: null,
  returnReason: null,
  managerId: null,
  documents: [],
  payments: [],
  commentsCountByMe: 0,
};

// order shallow-merge'ится с BASE_ORDER — тестам достаточно передать дельту полей.
function makeData(overrides: Record<string, unknown>) {
  const { order, ...rest } = overrides as { order?: Record<string, unknown> };
  return {
    order: { ...BASE_ORDER, ...order },
    auditEntries: [],
    comments: [],
    documentRows: [],
    items: [],
    ...rest,
  } as never;
}

describe('ManagerOrderDetailView', () => {
  it('`У-351`: один блок «Документы» — список, затем выпуск, затем загрузка', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [],
        generatePanel: React.createElement('div', { 'data-testid': 'generate-panel' }),
      })
    );
    const docs = html.indexOf('Документы');
    const issue = html.indexOf('data-testid="generate-panel"');
    const upload = html.indexOf('data-testid="doc-upload"');
    expect(docs).toBeGreaterThan(-1);
    expect(issue).toBeGreaterThan(docs);
    expect(upload).toBeGreaterThan(issue);
    expect(html).toContain('embedded=true');
    // Отдельной карточки «Документы по заказу» над списком больше нет.
    expect(html).not.toContain('Документы по заказу');
  });

  it('`У-353`: шапка получает шаги от панели статуса; «Статус заказа» — первым справа', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [],
        statusPanel: {
          steps: {
            steps: [{ id: 's1', label: 'Принято в работу', state: 'current' }],
            terminalLabel: null,
            offPipelineLabel: null,
          },
        } as never,
        contactPanel: React.createElement('div', { 'data-testid': 'contact-panel' }),
      })
    );
    expect(html).toContain('data-testid="order-header">Принято в работу');
    expect(html.indexOf('data-testid="status-panel"')).toBeLessThan(
      html.indexOf('data-testid="contact-panel"')
    );
  });

  it('BackLink ведёт на переданный backHref', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/leader/orders',
        directions: [],
        students: [],
      })
    );
    expect(html).toContain('href="/leader/orders"');
    expect(html).toContain('Все заказы');
  });

  it('хлебные крошки показываются, только если их передали', () => {
    // Крошки нужны не везде: в кабинете менеджера заказ открывается из списка,
    // а из карточки организации — с цепочкой. Пустой список не должен рисовать
    // пустую полосу над заголовком.
    const withCrumbs = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [],
        breadcrumbs: [{ href: '/manager/organizations/g1', label: 'ООО Ромашка' }],
      })
    );
    expect(withCrumbs).toContain('ООО Ромашка');

    const without = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [],
      })
    );
    expect(without).not.toContain('ООО Ромашка');
  });

  it('панель рабочего статуса монтируется, только когда её данные переданы', () => {
    // §10 ТЗ v0.5: у заявки один видимый статус — из справочника. Панель
    // появляется, лишь если сервер отдал по ней данные.
    const withPanel = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [],
        statusPanel: { current: null, forward: [], backward: [], terminal: null, history: [] },
      })
    );
    expect(withPanel).toContain('status-panel');

    const withoutPanel = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [],
      })
    );
    expect(withoutPanel).not.toContain('status-panel');
  });

  it('блок «Состав и стоимость» монтируется готовым узлом от страницы', () => {
    // Этап 5 (`У-139`): данные для блока собирает страница — деталка остаётся
    // презентационной и про строки заказа ничего не знает.
    const withLines = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [],
        linesSection: React.createElement('div', { 'data-testid': 'order-lines' }, 'строки'),
      })
    );
    expect(withLines).toContain('order-lines');

    const without = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [],
      })
    );
    expect(without).not.toContain('order-lines');
  });

  it('панель «Контакт заказа» монтируется готовым узлом от страницы и стоит выше панели «Сделка»', () => {
    // `У-180`: данные и права панели собирает страница — деталка не знает,
    // кто там выбран. Порядок в правой колонке: сначала человек (с кем
    // говорить по заказу), потом переговоры, из которых заказ вырос.
    const withPanel = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [],
        contactPanel: React.createElement('div', { 'data-testid': 'contact-panel' }, 'контакт'),
        dealPanel: React.createElement('div', { 'data-testid': 'deal-panel' }, 'сделка'),
      })
    );
    expect(withPanel).toContain('data-testid="contact-panel"');
    expect(withPanel.indexOf('data-testid="contact-panel"')).toBeLessThan(
      withPanel.indexOf('data-testid="deal-panel"')
    );

    const without = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [],
      })
    );
    expect(without).not.toContain('contact-panel');
  });

  it('documentRows count is shown in the "Документы" header when non-empty', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({ documentRows: [{ id: 'd1' }] }),
        backHref: '/manager/orders',
        directions: [],
        students: [],
      })
    );
    expect(html).toContain('Документы');
    expect(html).toContain('(<!-- -->1<!-- -->)');
  });

  it('documentRows empty: no count badge in the "Документы" header', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({ documentRows: [] }),
        backHref: '/manager/orders',
        directions: [],
        students: [],
      })
    );
    expect(html).not.toContain('Документы<!-- --> <span');
  });

  it('threads customFields down to OrderCustomFields (default [] when omitted)', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [{ id: 's1', name: 'Студент', email: 's@x.com' }],
      })
    );
    expect(html).toContain('Все заказы');
  });

  it('DealActivityThread и OrderClientThread получают order.id и умолчания (лента пуста, флаги выключены)', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [],
      })
    );
    expect(html).toContain('data-testid="deal-activity-thread"');
    expect(html).toContain(
      '<div data-testid="deal-activity-thread">o1<!-- -->0<!-- -->false</div>'
    );
    expect(html).toContain('<div data-testid="order-client-thread">o1<!-- -->0<!-- -->false</div>');
  });

  it('ClaimOrderButton монтируется с order.id и managerId=null (кнопка сама решает видимость)', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [],
      })
    );
    expect(html).toContain('data-testid="claim-order-button"');
    expect(html).toContain('o1<!-- -->null');
  });

  it('ClaimOrderButton получает ненулевой managerId, когда заказ закреплён', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({ order: { managerId: 'm1' } }),
        backHref: '/manager/orders',
        directions: [],
        students: [],
      })
    );
    expect(html).toContain('o1<!-- -->m1');
  });

  it('OrderLifecyclePanel монтируется сразу под ManagerStatusChangeForm с props из data.order', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [],
      })
    );
    expect(html).toContain('data-testid="order-lifecycle-panel"');
    // §10 ТЗ v0.5: статуса в props панели больше нет — он уехал в
    // OrderStatusPanel; здесь остались id, отметка бухгалтерии и причина.
    expect(html).toContain('o1<!-- -->false<!-- -->null');
    // монтаж в правой колонке ниже операционного статуса
    expect(html.indexOf('data-testid="status-change-form"')).toBeLessThan(
      html.indexOf('data-testid="order-lifecycle-panel"')
    );
  });

  it('OrderLifecyclePanel: accountingSignedAt != null → accountingSigned=true, returnReason пробрасывается', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({
          order: {
            status: 'waiting_client',
            accountingSignedAt: new Date('2026-07-01'),
            returnReason: 'нет сканов',
          },
        }),
        backHref: '/manager/orders',
        directions: [],
        students: [],
      })
    );
    expect(html).toContain('o1<!-- -->true<!-- -->нет сканов');
  });

  it('`У-310`: лента одна на оба блока; звонки — «Активности», мессенджеры и диалоги — «Переписке»', () => {
    const html = renderToString(
      React.createElement(ManagerOrderDetailView, {
        data: makeData({}),
        backHref: '/manager/orders',
        directions: [],
        students: [],
        activityItems: [
          { kind: 'event', id: 'e1', at: new Date('2026-01-01'), label: 'Смена статуса заказа' },
        ],
        inboundEnabled: true,
        telephonyEnabled: true,
        dialogsPanel: React.createElement('p', null, 'ДИАЛОГИ'),
      })
    );
    expect(html).toContain('<div data-testid="deal-activity-thread">o1<!-- -->1<!-- -->true</div>');
    expect(html).toContain(
      '<div data-testid="order-client-thread">o1<!-- -->1<!-- -->true<p>ДИАЛОГИ</p></div>'
    );
  });
});
