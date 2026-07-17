import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listCalendarItems, getEventFormOptions } from '@/lib/services/calendar/items';
import { normalizeMonthParam, monthGridRange } from '@/lib/calendar/month';
import { CalendarMonthView } from '@/components/calendar/calendar-month-view';

export const dynamic = 'force-dynamic';

export default async function LeaderCalendarPage({
  searchParams
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  if (!isFeatureEnabled('staff_calendar')) notFound();
  const session = await requireManagerLeader();
  const today = new Date();
  const month = normalizeMonthParam((await searchParams).m, today);
  const range = monthGridRange(month);
  const [items, options] = await Promise.all([
    listCalendarItems(prisma, session, range),
    getEventFormOptions(prisma, session)
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Календарь</h1>
        <p className="text-sm text-gray-500 mt-1">
          События команды и задачи со сроком — в одной сетке. Кликните по дню, чтобы создать событие.
        </p>
      </div>
      <CalendarMonthView
        items={items}
        options={options}
        month={month}
        today={today}
        calendarHref="/leader/calendar"
        tasksHref="/leader/tasks"
      />
    </div>
  );
}
