import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OrderDealPanel } from '@/components/orders/order-deal-panel';
import type { OrderDeal } from '@/lib/services/manager/orderDetail';

const FULL: NonNullable<OrderDeal> = {
  id: 'd1',
  title: 'Сделка с Ромашкой',
  amount: '120000.00',
  status: 'won',
  wonAt: new Date('2026-08-01T10:00:00Z'),
  stageName: 'Выиграна',
  managerName: 'Иванова А.',
  lead: {
    id: 'l1',
    clientCompanyName: 'ООО «Ромашка»',
    sourceRequest: { id: 'r1', subject: 'Нужно обучение' },
  },
};

function render(deal: NonNullable<OrderDeal>, dealsHref: string | null, leadHrefBase: string | null) {
  return renderToString(
    <OrderDealPanel deal={deal} dealsHref={dealsHref} leadHrefBase={leadHrefBase} />
  );
}

describe('OrderDealPanel', () => {
  it('показывает сделку целиком: заголовок, статус, стадию, сумму, ответственного и дату выигрыша', () => {
    const html = render(FULL, '/manager/deals', '/manager/leads');

    expect(html).toContain('Сделка');
    expect(html).toContain('Переговоры, из которых вырос этот заказ');
    expect(html).toContain('Сделка с Ромашкой');
    expect(html).toContain('Выиграна');
    expect(html).toContain('Ответственный');
    expect(html).toContain('Иванова А.');
    expect(html).toContain('120');
    expect(html).toContain('Выиграна');
  });

  it('цепочку происхождения показывает ссылкой на лид и темой обращения', () => {
    const html = render(FULL, '/manager/deals', '/manager/leads');

    expect(html).toContain('Откуда пришла сделка');
    expect(html).toContain('/manager/leads/l1');
    expect(html).toContain('ООО «Ромашка»');
    expect(html).toContain('Нужно обучение');
  });

  it('без адреса лидов имя лида остаётся текстом — ссылки в несуществующий раздел нет', () => {
    const html = render(FULL, '/leader/deals', null);

    expect(html).toContain('ООО «Ромашка»');
    expect(html).not.toContain('/leader/leads');
    expect(html).not.toContain('<a href="/manager/leads');
  });

  it('без адреса доски ссылки «Все сделки» нет (кабинет админа)', () => {
    const html = render(FULL, null, null);

    expect(html).not.toContain('Все сделки');
  });

  it('ссылка «Все сделки» ведёт на доску своего кабинета', () => {
    expect(render(FULL, '/manager/deals', null)).toContain('/manager/deals');
    expect(render(FULL, '/leader/deals', null)).toContain('/leader/deals');
  });

  it.each([
    ['open' as const, 'В работе'],
    ['won' as const, 'Выиграна'],
    ['lost' as const, 'Проиграна'],
  ])('статус %s подписан по-русски: %s', (status, label) => {
    const html = render({ ...FULL, status, stageName: null }, null, null);

    expect(html).toContain(label);
  });

  it('пустые сумма, стадия, ответственный, дата и лид просто не показываются', () => {
    const html = render(
      { ...FULL, amount: null, stageName: null, managerName: null, wonAt: null, lead: null },
      null,
      null
    );

    expect(html).toContain('Сделка с Ромашкой');
    expect(html).not.toContain('Стадия');
    expect(html).not.toContain('Сумма');
    expect(html).not.toContain('Ответственный');
    expect(html).not.toContain('Откуда пришла сделка');
  });

  it('лид без исходного обращения не рисует строку «Обращение»', () => {
    const html = render(
      { ...FULL, lead: { id: 'l1', clientCompanyName: 'ООО «Ромашка»', sourceRequest: null } },
      null,
      '/manager/leads'
    );

    expect(html).toContain('Откуда пришла сделка');
    expect(html).not.toContain('Обращение<');
  });
});
