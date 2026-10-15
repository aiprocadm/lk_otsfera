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
  intakeDueWithinHour: 0,
  intakeOverdue: 0,
  readyToDeliver: 0,
  readyOrders: [],
  readyTruncated: false,
  dealsOpen: 0,
  dealsByStage: [],
  // `У-226` (этап 4 ТЗ 12.09.2026): показатели сводки.
  dialogsWaiting: 0,
  proposalsExpiring: 0,
  eventsToday: 0,
};

const FULL: MyDayData = {
  tasksToday: 3,
  tasksOverdue: 2,
  intake: 7,
  intakeDueWithinHour: 2,
  intakeOverdue: 3,
  readyToDeliver: 6,
  readyOrders: [
    { id: 'o1', orderNumber: '2026-1', title: 'Обучение по ОТ' },
    { id: 'o2', orderNumber: null, title: 'Разработка документов' },
  ],
  readyTruncated: true,
  dealsOpen: 5,
  dealsByStage: [
    { stageName: 'Переговоры', count: 3 },
    { stageName: 'Счёт', count: 2 },
  ],
  dialogsWaiting: 4,
  proposalsExpiring: 2,
  eventsToday: 3,
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
      'Готово к передаче',
      'Мои сделки',
      'Свежие обращения',
    ]) {
      expect(html).toContain(title);
    }
    // Этап 4 ТЗ 13.10.2026: «Поступило» (`У-293`) и чек-листы (`У-296`) убраны.
    expect(html).not.toContain('Поступило');
    expect(html).not.toContain('Шагов в чек-листах');
  });

  it('каждая карточка — ссылка в свой раздел', () => {
    const html = render(FULL);
    for (const href of [
      '/manager/tasks',
      '/manager/tasks?overdue=1',
      '/manager/intake',
      // `У-295`: «Готово к передаче» — в «Заказы» с тем же фильтром.
      '/manager/orders?focus=ready',
      '/manager/deals',
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it('пустой день: карточки на месте и объясняют пустоту', () => {
    const html = render(EMPTY);
    expect(html).toContain('Готово к передаче');
    expect(html).toContain('На сегодня задач нет');
    expect(html).toContain('Просроченных нет');
    expect(html).toContain('Неотвеченных обращений нет');
    expect(html).toContain('Готовых к передаче заказов нет');
    expect(html).toContain('Открытых сделок нет');
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

  it('этап 4 ТЗ 13.10.2026 (`У-293`, `У-294`): одна карточка обращений — вся очередь и сроки ответа', () => {
    const html = render(FULL);
    expect(html.match(/Свежие обращения/g)).toHaveLength(1);
    const slaOf = (h: string) => {
      const from = h.indexOf('data-testid="intake-sla"');
      return h.slice(from, h.indexOf('</ul>', from));
    };
    const sla = slaOf(html);
    expect(sla).toMatch(/Остался 1 час на ответ<\/span><span[^>]*>2</);
    expect(sla).toMatch(/Просрочено<\/span><span[^>]*>3</);
    // Просрочка подсвечена; без неё — нет.
    expect(sla).toContain('text-[#EA580C]');
    const calm = render({ ...FULL, intakeOverdue: 0 });
    expect(slaOf(calm)).not.toContain('text-[#EA580C]');
  });

  it('заголовок раздела связан с секцией через aria-labelledby', () => {
    const html = render(EMPTY);
    expect(html).toContain('aria-labelledby="my-day-heading"');
    expect(html).toContain('id="my-day-heading"');
  });
});
