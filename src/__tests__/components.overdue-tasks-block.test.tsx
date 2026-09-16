import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverdueTasksBlock } from '@/components/leader/overdue-tasks-block';
import type { OverdueTaskRow } from '@/lib/services/tasks/overdue';

/**
 * Блок «Просроченные задачи» на главной руководителя (`У-225`, этап 4).
 *
 * До него просрочка была одной цифрой в «Моём дне» менеджера — у руководителя
 * её не было вовсе. Здесь проверяется то, что делает блок полезным: видно, ЧТО
 * висит, СКОЛЬКО дней и НА КОМ, а пустой блок объясняет, что это хорошая
 * новость, а не поломка (`У-74`).
 */

const row = (over: Partial<OverdueTaskRow> = {}): OverdueTaskRow => ({
  id: 't1',
  title: 'Проверить документы',
  dueDate: new Date('2026-09-10T12:00:00.000Z'),
  overdueDays: 5,
  assigneeNames: ['Иван'],
  ...over,
});

const render = (props: Parameters<typeof OverdueTasksBlock>[0]): string =>
  renderToStaticMarkup(<OverdueTasksBlock {...props} />);

describe('OverdueTasksBlock', () => {
  it('пусто — это ХОРОШАЯ новость, и блок так и говорит', () => {
    const html = render({ rows: [], total: 0, href: '/leader/tasks' });
    expect(html).toContain('Просроченные задачи');
    expect(html).toContain('Просроченных задач нет');
    // «Нет данных» в одиночку — не ответ (`У-74`): человек должен понять, что
    // всё в порядке, а не решить, что раздел сломался.
    expect(html).toContain('команда идёт по срокам');
    expect(html).not.toContain('Показать все');
  });

  it('показывает название, дни просрочки и исполнителей', () => {
    const html = render({ rows: [row()], total: 1, href: '/leader/tasks' });
    expect(html).toContain('Проверить документы');
    expect(html).toContain('просрочена на 5 дн.');
    expect(html).toContain('Иван');
    expect(html).toContain('href="/leader/tasks/t1"');
  });

  it('задача без исполнителя подписана словами, а не пустотой', () => {
    const html = render({ rows: [row({ assigneeNames: [] })], total: 1, href: '/leader/tasks' });
    expect(html).toContain('без исполнителя');
  });

  it('несколько исполнителей перечисляются через запятую', () => {
    const html = render({
      rows: [row({ assigneeNames: ['Иван', 'Пётр'] })],
      total: 1,
      href: '/leader/tasks',
    });
    expect(html).toContain('Иван, Пётр');
  });

  it('когда показано не всё — есть ссылка «Показать все» с честным числом', () => {
    const html = render({ rows: [row()], total: 12, href: '/leader/tasks' });
    expect(html).toContain('Показать все (12)');
    expect(html).toContain('href="/leader/tasks?overdue=1"');
    // Общее число видно сразу, а не только в ссылке.
    expect(html).toContain('>12<');
  });

  it('когда показано всё — ссылки «Показать все» нет', () => {
    const html = render({ rows: [row()], total: 1, href: '/leader/tasks' });
    expect(html).not.toContain('Показать все');
  });
});
