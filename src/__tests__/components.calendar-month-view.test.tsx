// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

vi.mock('next/link', () => ({
  default: ({ children, ...rest }: { children: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('a', rest, children)
}));

// EventDialog is covered by its own dedicated test file — stub it here so the
// month view's coverage isolates to its own logic (grid/chips/upcoming/nav).
const { eventDialogSpy } = vi.hoisted(() => ({ eventDialogSpy: vi.fn() }));
vi.mock('@/components/calendar/event-dialog', () => ({
  EventDialog: (props: { target: { id: string } | null; onClose: () => void; onSaved: () => void }) => {
    eventDialogSpy(props);
    return React.createElement(
      'div',
      { 'data-testid': 'event-dialog-stub' },
      React.createElement('button', { onClick: props.onClose }, 'stub-close'),
      React.createElement('button', { onClick: props.onSaved }, 'stub-saved')
    );
  }
}));

import { CalendarMonthView } from '@/components/calendar/calendar-month-view';
import type { CalendarItem, EventFormOptions } from '@/lib/services/calendar/items';

const options: EventFormOptions = { users: [], organizations: [], orders: [] };

const MONTH = '2026-08';
const TODAY = new Date(2026, 7, 10, 12, 0); // 10.08.2026 12:00

function eventItem(overrides: Partial<CalendarItem>): CalendarItem {
  return {
    kind: 'event',
    id: 'e-1',
    title: 'Событие',
    date: new Date(2026, 7, 12, 10, 0),
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
    ...overrides
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
    ...overrides
  };
}

const pastEvent = eventItem({ id: 'e-past', title: 'Прошедшее событие', date: new Date(2026, 7, 5, 9, 0) });
const futEvent = eventItem({
  id: 'e-fut',
  title: 'Планёрка',
  date: new Date(2026, 7, 12, 10, 0),
  location: 'Zoom'
});
const taskOpen = taskItem({ id: 't-open', title: 'Открытая задача', date: new Date(2026, 7, 15) });
const taskDone = taskItem({
  id: 't-done',
  title: 'Готовая задача',
  date: new Date(2026, 7, 20),
  completedAt: new Date(2026, 7, 1)
});

const items: CalendarItem[] = [pastEvent, futEvent, taskOpen, taskDone];

function renderView(overrides: Partial<React.ComponentProps<typeof CalendarMonthView>> = {}) {
  return render(
    React.createElement(CalendarMonthView, {
      items,
      options,
      month: MONTH,
      today: TODAY,
      calendarHref: '/manager/calendar',
      tasksHref: '/manager/tasks',
      ...overrides
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
    const second = eventItem({ id: 'e-fut-2', title: 'Созвон с клиентом', date: new Date(2026, 7, 12, 15, 0) });
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
    expect(screen.getByLabelText('Предыдущий месяц').getAttribute('href')).toBe('/manager/calendar?m=2026-07');
    expect(screen.getByLabelText('Следующий месяц').getAttribute('href')).toBe('/manager/calendar?m=2026-09');
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
    expect(props.createDate.getFullYear()).toBe(2026);
    expect(props.createDate.getMonth()).toBe(7);
    expect(props.createDate.getDate()).toBe(15);
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
