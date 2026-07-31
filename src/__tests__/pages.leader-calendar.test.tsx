// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { monthGridRange, normalizeMonthParam } from '@/lib/calendar/month';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { listCalendarItems, getEventFormOptions } = vi.hoisted(() => ({
  listCalendarItems: vi.fn(),
  getEventFormOptions: vi.fn(),
}));
vi.mock('@/lib/services/calendar/items', () => ({ listCalendarItems, getEventFormOptions }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

const { monthViewSpy } = vi.hoisted(() => ({ monthViewSpy: vi.fn() }));
vi.mock('@/components/calendar/calendar-month-view', () => ({
  CalendarMonthView: (props: Record<string, unknown>) => {
    monthViewSpy(props);
    return React.createElement(
      'div',
      { 'data-testid': 'calendar-month-view' },
      JSON.stringify({
        month: props.month,
        calendarHref: props.calendarHref,
        tasksHref: props.tasksHref,
      })
    );
  },
}));

import LeaderCalendarPage from '@/app/leader/calendar/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  managerRole: 'leader' as const,
  companyId: 'c1',
};

function pageProps(m?: string) {
  return { searchParams: Promise.resolve(m === undefined ? {} : { m }) };
}

describe('LeaderCalendarPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    isFeatureEnabled.mockReset();
    listCalendarItems.mockReset();
    getEventFormOptions.mockReset();
    nav.notFound.mockClear();
    monthViewSpy.mockClear();
  });

  it('calls notFound() when the staff_calendar flag is disabled (before auth check)', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(renderServerComponent(LeaderCalendarPage(pageProps()))).rejects.toThrow(
      'NOT_FOUND'
    );

    expect(isFeatureEnabled).toHaveBeenCalledWith('staff_calendar');
    expect(requireManagerLeader).not.toHaveBeenCalled();
  });

  it('renders the calendar for the current month when the flag is enabled', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    listCalendarItems.mockResolvedValue([]);
    getEventFormOptions.mockResolvedValue({ users: [], organizations: [], orders: [] });

    const { container } = await renderServerComponent(LeaderCalendarPage(pageProps()));

    const expectedMonth = normalizeMonthParam(undefined, new Date());
    expect(listCalendarItems).toHaveBeenCalledWith({}, SESSION, monthGridRange(expectedMonth));
    expect(getEventFormOptions).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Календарь');
    const props = monthViewSpy.mock.calls[0][0];
    expect(props.month).toBe(expectedMonth);
    expect(props.calendarHref).toBe('/leader/calendar');
    expect(props.tasksHref).toBe('/leader/tasks');
  });

  it('passes ?m=2026-08 through to the fetch range and the month prop', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    listCalendarItems.mockResolvedValue([]);
    getEventFormOptions.mockResolvedValue({ users: [], organizations: [], orders: [] });

    await renderServerComponent(LeaderCalendarPage(pageProps('2026-08')));

    expect(listCalendarItems).toHaveBeenCalledWith({}, SESSION, monthGridRange('2026-08'));
    expect(monthViewSpy.mock.calls[0][0].month).toBe('2026-08');
  });
});
