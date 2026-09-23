// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

vi.mock('next/link', () => ({
  default: ({ children, ...rest }: { children: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('a', rest, children),
}));

// EventDialog is covered by its own dedicated test file — stub it here so the
// month view's coverage isolates to its own logic (grid/chips/upcoming/nav).
const { eventDialogSpy } = vi.hoisted(() => ({ eventDialogSpy: vi.fn() }));
vi.mock('@/components/calendar/event-dialog', () => ({
  EventDialog: (props: {
    target: { id: string } | null;
    onClose: () => void;
    onSaved: () => void;
  }) => {
    eventDialogSpy(props);
    return React.createElement(
      'div',
      { 'data-testid': 'event-dialog-stub' },
      React.createElement('button', { onClick: props.onClose }, 'stub-close'),
      React.createElement('button', { onClick: props.onSaved }, 'stub-saved')
    );
  },
}));

import { CalendarMonthView } from '@/components/calendar/calendar-month-view';
import type { CalendarItem, EventFormOptions } from '@/lib/services/calendar/items';

const options: EventFormOptions = { users: [], organizations: [], orders: [] };

const MONTH = '2026-08';
const TODAY = new Date('2026-08-10T09:00:00.000Z'); // 10.08.2026 12:00 по Москве

/*
 * Моменты событий — такие, какими их кладёт в базу настоящий писатель: action
 * календаря читает «10:00» из формы по Москве, то есть 07:00Z (прогон
 * сопровождения №36, `Р-М-4`). Прежде здесь стояли даты в поясе процесса теста
 * (UTC), и «10:00» на чипе совпадало с дефектом: сервер рисовал часы по
 * Гринвичу, браузер — по Москве. Сроки задач — полночь UTC, как из поля даты.
 */

function eventItem(overrides: Partial<CalendarItem>): CalendarItem {
  return {
    kind: 'event',
    id: 'e-1',
    title: 'Событие',
    date: new Date('2026-08-12T07:00:00.000Z'),
    endsAt: null,
    allDay: false,
    location: null,
    description: null,
    createdById: 'u1',
    createdByName: 'Иван',
    attendeeIds: [],
    attendeeNames: [],
    remindMinutes: null,
    linkedOrderId: null,
    linkedOrderTitle: null,
    linkedOrganizationId: null,
    linkedOrganizationName: null,
    priority: null,
    completedAt: null,
    ...overrides,
  };
}

function taskItem(overrides: Partial<CalendarItem>): CalendarItem {
  return {
    ...eventItem({}),
    kind: 'task',
    id: 't-1',
    title: 'Задача',
    allDay: true,
    createdById: null,
    createdByName: null,
    priority: 'medium' as CalendarItem['priority'],
    ...overrides,
  };
}

const pastEvent = eventItem({
  id: 'e-past',
  title: 'Прошедшее событие',
  date: new Date('2026-08-05T06:00:00.000Z'),
});
const futEvent = eventItem({
  id: 'e-fut',
  title: 'Планёрка',
  date: new Date('2026-08-12T07:00:00.000Z'),
  location: 'Zoom',
});
const taskOpen = taskItem({
  id: 't-open',
  title: 'Открытая задача',
  date: new Date('2026-08-15T00:00:00.000Z'),
});
const taskDone = taskItem({
  id: 't-done',
  title: 'Готовая задача',
  date: new Date('2026-08-20T00:00:00.000Z'),
  completedAt: new Date('2026-08-01T09:00:00.000Z'),
});

const items: CalendarItem[] = [pastEvent, futEvent, taskOpen, taskDone];

/** Срок «10.08.2026» из поля даты формы задачи — полночь UTC. */
const TODAY_DUE = new Date('2026-08-10T00:00:00.000Z');

function renderView(overrides: Partial<React.ComponentProps<typeof CalendarMonthView>> = {}) {
  return render(
    React.createElement(CalendarMonthView, {
      items,
      options,
      month: MONTH,
      today: TODAY,
      calendarHref: '/manager/calendar',
      tasksHref: '/manager/tasks',
      ...overrides,
    })
  );
}

describe('CalendarMonthView', () => {
  beforeEach(() => {
    refresh.mockClear();
    eventDialogSpy.mockClear();
  });

  it('renders a 6×7 grid: 42 day cells, each with a per-day "add event" button', () => {
    renderView();
    const addButtons = screen.getAllByRole('button', { name: /^Новое событие \d{4}-\d{2}-\d{2}$/ });
    expect(addButtons).toHaveLength(42);
    // August 2026 grid starts on Mon 27.07 and ends on Sun 06.09.
    expect(screen.getByRole('button', { name: 'Новое событие 2026-07-27' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Новое событие 2026-09-06' })).toBeTruthy();
  });

  it('два события в один день показываются оба в одной ячейке', () => {
    // Группировка по дням — самое частое место, где теряется вторая запись:
    // день уже есть в списке, и элемент должен добавиться к нему, а не заменить.
    const second = eventItem({
      id: 'e-fut-2',
      title: 'Созвон с клиентом',
      date: new Date('2026-08-12T12:00:00.000Z'),
    });
    renderView({ items: [...items, second] });
    expect(screen.getByTitle('Планёрка')).toBeTruthy();
    expect(screen.getByTitle('Созвон с клиентом')).toBeTruthy();
  });

  it('clicking an event chip opens the dialog in edit mode with that item', () => {
    renderView();
    const chip = screen.getByTitle('Планёрка');
    expect(chip.textContent).toContain('10:00');
    fireEvent.click(chip);
    const props = eventDialogSpy.mock.calls[eventDialogSpy.mock.calls.length - 1][0];
    expect(props.target.id).toBe('e-fut');
  });

  /**
   * Прогон сопровождения №36 (спека 2026-09-23-moscow-time-in-server-code-design,
   * группа Д): подписи времени и числа клеток — по Москве, как и сама
   * раскладка по клеткам (`dayKey`). Процесс теста живёт в UTC, как сервер.
   */
  describe('время и числа — по Москве', () => {
    it('событие в 00:30 по Москве стоит в своей клетке с подписью «00:30», а не «21:30» вчера', () => {
      const night = eventItem({
        id: 'e-night',
        title: 'Ночной созвон',
        date: new Date('2026-08-12T21:30:00.000Z'), // 13.08 00:30 МСК
      });
      const { container } = renderView({ items: [night] });
      const chip = screen.getByTitle('Ночной созвон');
      expect(chip.textContent).toBe('00:30 Ночной созвон');
      const cell = screen.getByRole('button', { name: 'Новое событие 2026-08-13' }).parentElement!
        .parentElement!;
      expect(cell.contains(chip)).toBe(true);
      expect(container.querySelector('li')?.textContent).toContain('13.08 00:30');
    });

    it('событие в 23:30 по Москве (20:30 UTC) — тот же московский день и час', () => {
      const late = eventItem({
        id: 'e-late',
        title: 'Поздняя встреча',
        date: new Date('2026-08-12T20:30:00.000Z'),
      });
      const { container } = renderView({ items: [late] });
      expect(screen.getByTitle('Поздняя встреча').textContent).toBe('23:30 Поздняя встреча');
      expect(container.querySelector('li')?.textContent).toContain('12.08 23:30');
    });

    it('срок задачи в «Ближайших» — только число, без выдуманного «03:00»', () => {
      // Срок из формы задачи — полночь UTC дня 15.08; по Москве это 03:00, но
      // у срока нет времени суток. Чип в сетке время тоже не пишет.
      const { container } = renderView({ items: [taskOpen] });
      const row = container.querySelector('li')?.textContent ?? '';
      expect(row).toContain('15.08');
      expect(row).not.toContain(':');
    });

    it('задача со сроком «сегодня» остаётся в «Ближайших» весь московский день (Р-М-3)', () => {
      // 10.08 23:30 по Москве = 20:30 UTC: срок 10.08 (00:00Z) уже позади
      // момента «сейчас», но его московский день ещё не кончился.
      const dueToday = taskItem({ id: 't-today', title: 'Сдать отчёт', date: TODAY_DUE });
      const lateEvening = new Date('2026-08-10T20:30:00.000Z');
      const { container } = renderView({ items: [dueToday], today: lateEvening });
      expect(container.querySelector('li')?.textContent).toContain('Сдать отчёт');
      // С 00:00 по Москве 11.08 (21:00 UTC 10.08) срок уже прошёл.
      const { container: next } = renderView({
        items: [dueToday],
        today: new Date('2026-08-10T21:00:00.000Z'),
      });
      expect(next.querySelectorAll('li')).toHaveLength(0);
    });

    it('число в клетке совпадает с её московским днём, а не с днём процесса', () => {
      // Клетка — московская полночь, по UTC это 21:00 накануне: `getDate()`
      // сервера печатал «14» в клетке 15 августа.
      renderView();
      for (const [key, day] of [
        ['2026-07-27', '27'],
        ['2026-08-15', '15'],
        ['2026-09-06', '6'],
      ] as const) {
        const addButton = screen.getByRole('button', { name: `Новое событие ${key}` });
        expect(addButton.previousElementSibling?.textContent).toBe(day);
      }
    });
  });

  it('an all-day event chip renders without a time prefix', () => {
    renderView({ items: [eventItem({ id: 'e-allday', title: 'Весь день', allDay: true })] });
    expect(screen.getByTitle('Весь день').textContent).not.toContain(':');
  });

  it('task chips are links to tasksHref; a completed task is struck through', () => {
    renderView();
    const openChip = screen.getByTitle('Задача: Открытая задача');
    expect(openChip.getAttribute('href')).toBe('/manager/tasks');
    expect(openChip.className).not.toContain('line-through');
    const doneChip = screen.getByTitle('Задача: Готовая задача');
    expect(doneChip.getAttribute('href')).toBe('/manager/tasks');
    expect(doneChip.className).toContain('line-through');
  });

  it('upcoming panel lists only future items and excludes completed tasks', () => {
    const { container } = renderView();
    const rows = container.querySelectorAll('li');
    expect(rows).toHaveLength(2); // futEvent + taskOpen; pastEvent and taskDone are cut off
    expect(rows[0].textContent).toContain('12.08 10:00');
    expect(rows[0].textContent).toContain('Планёрка');
    expect(rows[0].textContent).toContain('· Zoom');
    expect(rows[1].textContent).toContain('Открытая задача');
    // The upcoming task row links to the task board.
    expect(rows[1].querySelector('a')?.getAttribute('href')).toBe('/manager/tasks');
  });

  it('clicking an upcoming event row opens the edit dialog', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /Планёрка · Zoom/ }));
    const props = eventDialogSpy.mock.calls[eventDialogSpy.mock.calls.length - 1][0];
    expect(props.target.id).toBe('e-fut');
  });

  it('upcoming panel shows the empty state when nothing is planned', () => {
    renderView({ items: [] });
    expect(screen.getByText('В этом месяце ничего не запланировано.')).toBeTruthy();
  });

  it('upcoming panel is capped at 8 items', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      eventItem({ id: `e-${i}`, title: `Событие ${i}`, date: new Date(2026, 7, 11 + i, 9, 0) })
    );
    const { container } = renderView({ items: many });
    expect(container.querySelectorAll('li')).toHaveLength(8);
  });

  it('prev/next/today navigation links carry the correct ?m=', () => {
    renderView();
    expect(screen.getByLabelText('Предыдущий месяц').getAttribute('href')).toBe(
      '/manager/calendar?m=2026-07'
    );
    expect(screen.getByLabelText('Следующий месяц').getAttribute('href')).toBe(
      '/manager/calendar?m=2026-09'
    );
    expect(screen.getByText('Сегодня').getAttribute('href')).toBe('/manager/calendar');
    expect(screen.getByText('Август 2026')).toBeTruthy();
  });

  it('"+ Новое событие" opens the create dialog with today as the date', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: '+ Новое событие' }));
    const props = eventDialogSpy.mock.calls[eventDialogSpy.mock.calls.length - 1][0];
    expect(props.target).toBeNull();
    expect(props.createDate.getTime()).toBe(TODAY.getTime());
  });

  it('a day cell "+" opens the create dialog with that day as the date', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Новое событие 2026-08-15' }));
    const props = eventDialogSpy.mock.calls[eventDialogSpy.mock.calls.length - 1][0];
    expect(props.target).toBeNull();
    // Дата клетки — МОСКОВСКАЯ полночь (`Д-22`, прогон №28), то есть 21:00
    // предыдущего дня по Гринвичу. Проверяем её по Москве: прежняя проверка
    // смотрела `getDate()` в зоне процесса и закрепляла ровно тот промах,
    // из-за которого встреча вставала во вчерашнюю клетку.
    expect(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(props.createDate)
    ).toBe('2026-08-15');
  });

  it('the dialog stub onClose closes it without refreshing', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: '+ Новое событие' }));
    expect(screen.getByTestId('event-dialog-stub')).toBeTruthy();
    fireEvent.click(screen.getByText('stub-close'));
    expect(screen.queryByTestId('event-dialog-stub')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('the dialog stub onSaved closes it and triggers router.refresh', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: '+ Новое событие' }));
    fireEvent.click(screen.getByText('stub-saved'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByTestId('event-dialog-stub')).toBeNull();
  });
});
