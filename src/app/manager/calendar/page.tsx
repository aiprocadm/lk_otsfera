import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listCalendarItems, getEventFormOptions } from '@/lib/services/calendar/items';
import { normalizeMonthParam, monthGridRange } from '@/lib/calendar/month';
import { CalendarMonthView } from '@/components/calendar/calendar-month-view';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

export default async function ManagerCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  if (!isFeatureEnabled('staff_calendar')) notFound();
  const session = await requireManager();
  const today = new Date();
  const month = normalizeMonthParam((await searchParams).m, today);
  const range = monthGridRange(month);
  const [items, options] = await Promise.all([
    listCalendarItems(prisma, session, range),
    getEventFormOptions(prisma, session),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title="Календарь"
          subtitle="События команды и задачи со сроком — в одной сетке. Кликните по дню, чтобы создать событие."
        />
      </div>
      <CalendarMonthView
        items={items}
        options={options}
        month={month}
        today={today}
        calendarHref="/manager/calendar"
        tasksHref="/manager/tasks"
      />
    </div>
  );
}
