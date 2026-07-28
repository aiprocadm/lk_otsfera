import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MyDayCards } from '@/components/manager/my-day-cards';
import type { MyDayData } from '@/lib/services/manager/myDay';

/**
 * Этап 11 PR-2 (ФТ-15.3) — карточки «Моего дня».
 * Требования ТЗ: цифра ведёт ссылкой туда, где с ней работают; нулевая
 * карточка не исчезает, а объясняет пустоту словами (ФТ-15.8).
 */

const EMPTY: MyDayData = {
  tasksToday: 0,
  tasksOverdue: 0,
  intake: 0,
  readyToDeliver: 0,
  readyOrders: [],
  readyTruncated: false,
  dealsOpen: 0,
  dealsByStage: [],
  inboundFresh: 0,
  callsMissed: 0
};

const FULL: MyDayData = {
  tasksToday: 3,
  tasksOverdue: 2,
  intake: 7,
  readyToDeliver: 6,
  readyOrders: [
    { id: 'o1', orderNumber: '2026-1', title: 'Обучение по ОТ' },
    { id: 'o2', orderNumber: null, title: 'Разработка документов' }
  ],
  readyTruncated: true,
  dealsOpen: 5,
  dealsByStage: [
    { stageName: 'Переговоры', count: 3 },
    { stageName: 'Счёт', count: 2 }
  ],
  inboundFresh: 4,
  callsMissed: 1
};

function render(data: MyDayData) {
  return renderToStaticMarkup(<MyDayCards data={data} />);
}

describe('MyDayCards', () => {
  it('показывает все карточки ТЗ', () => {
    const html = render(FULL);
    for (const title of [
      'Задачи на сегодня',
      'Просроченные задачи',
      'Поступило',
      'Готово к передаче',
      'Мои сделки',
      'Свежие обращения'
    ]) {
      expect(html).toContain(title);
    }
  });

  it('каждая карточка — ссылка в свой раздел', () => {
    const html = render(FULL);
    for (const href of [
      '/manager/tasks',
      '/manager/tasks?overdue=1',
      '/manager/intake',
      '/manager/orders',
      '/manager/deals',
      '/manager/inbox'
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it('пустой день: карточки на месте и объясняют пустоту', () => {
    const html = render(EMPTY);
    expect(html).toContain('Готово к передаче');
    expect(html).toContain('На сегодня задач нет');
    expect(html).toContain('Просроченных нет');
    expect(html).toContain('Новых обращений и звонков нет');
    expect(html).toContain('Готовых к передаче заказов нет');
    expect(html).toContain('Открытых сделок нет');
    expect(html).toContain('За сутки новых нет');
  });

  it('готовые заказы перечислены, номер выводится с решёткой', () => {
    const html = render(FULL);
    expect(html).toContain('№2026-1');
    expect(html).toContain('Обучение по ОТ');
    // Заказ без номера показывается одним названием.
    expect(html).toContain('Разработка документов');
    expect(html).toContain('и другие…');
  });

  it('без усечения подпись «и другие» не выводится', () => {
    const html = render({ ...FULL, readyTruncated: false });
    expect(html).not.toContain('и другие…');
  });

  it('сделки перечислены по стадиям с числами', () => {
    const html = render(FULL);
    expect(html).toContain('Переговоры');
    expect(html).toContain('Счёт');
  });

  it('пропущенные звонки показаны внутри карточки обращений', () => {
    expect(render(FULL)).toContain('Пропущенные звонки за сутки');
  });

  it('заголовок раздела связан с секцией через aria-labelledby', () => {
    const html = render(EMPTY);
    expect(html).toContain('aria-labelledby="my-day-heading"');
    expect(html).toContain('id="my-day-heading"');
  });
});
