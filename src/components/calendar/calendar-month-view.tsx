'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import {
  dayKey,
  isSameMonth,
  monthGridDays,
  monthLabel,
  nextMonth,
  prevMonth,
} from '@/lib/calendar/month';
import type { CalendarItem, EventFormOptions } from '@/lib/services/calendar/items';
import { EventDialog } from './event-dialog';

/**
 * M5 — месячная сетка staff-календаря + панель «Ближайшие» (спека §4 UI v1).
 * События — кликабельные чипы (редактирование в Dialog); задачи (трек G3) —
 * read-only чипы-ссылки на канбан. Навигация месяцев — `?m=YYYY-MM` (server
 * refetch, сетка и выборка делят math из lib/calendar/month).
 */

const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const UPCOMING_LIMIT = 8;

function timeLabel(d: Date): string {
  const dt = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function upcomingDateLabel(d: Date): string {
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')} ${timeLabel(dt)}`;
}

type DialogState = { mode: 'create'; date: Date } | { mode: 'edit'; item: CalendarItem } | null;

export function CalendarMonthView({
  items,
  options,
  month,
  today,
  calendarHref,
  tasksHref,
}: {
  items: CalendarItem[];
  options: EventFormOptions;
  /** YYYY-MM отображаемого месяца. */
  month: string;
  /** Серверное «сегодня» (подсветка ячейки + отсечка «Ближайших»). */
  today: Date;
  calendarHref: string;
  tasksHref: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dialog, setDialog] = useState<DialogState>(null);

  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const key = dayKey(new Date(item.date));
    const list = byDay.get(key);
    if (list) list.push(item);
    else byDay.set(key, [item]);
  }

  const days = monthGridDays(month);
  const todayKey = dayKey(new Date(today));
  const nowMs = new Date(today).getTime();
  const upcoming = items
    .filter(
      (i) => new Date(i.date).getTime() >= nowMs && (i.kind === 'event' || i.completedAt === null)
    )
    .slice(0, UPCOMING_LIMIT);

  function closeSaved() {
    setDialog(null);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={`${calendarHref}?m=${prevMonth(month)}`}
            aria-label="Предыдущий месяц"
            className="rounded border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50"
          >
            ←
          </Link>
          <h2 className="text-lg font-semibold text-[#111111] min-w-40 text-center">
            {monthLabel(month)}
          </h2>
          <Link
            href={`${calendarHref}?m=${nextMonth(month)}`}
            aria-label="Следующий месяц"
            className="rounded border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50"
          >
            →
          </Link>
          <Link
            href={calendarHref}
            className="ml-2 text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Сегодня
          </Link>
        </div>
        <Button type="button" onClick={() => setDialog({ mode: 'create', date: new Date(today) })}>
          + Новое событие
        </Button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[700px]">
          <div className="grid grid-cols-7 gap-px mb-px">
            {WEEKDAYS_RU.map((w) => (
              <div key={w} className="px-2 py-1 text-xs font-medium text-gray-500 text-center">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-gray-200 border border-gray-200 rounded-lg overflow-hidden">
            {days.map((day) => {
              const key = dayKey(day);
              const inMonth = isSameMonth(day, month);
              const dayItems = byDay.get(key) ?? [];
              return (
                <div
                  key={key}
                  className={`min-h-24 bg-white p-1 ${inMonth ? '' : 'bg-gray-50 text-gray-400'}`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs px-1 ${key === todayKey ? 'font-bold text-white bg-orange-500 rounded-full h-5 w-5 inline-flex items-center justify-center' : ''}`}
                    >
                      {day.getDate()}
                    </span>
                    <button
                      type="button"
                      aria-label={`Новое событие ${key}`}
                      onClick={() => setDialog({ mode: 'create', date: day })}
                      className="text-gray-300 hover:text-gray-500 text-xs px-1"
                    >
                      +
                    </button>
                  </div>
                  <div className="space-y-0.5 mt-0.5">
                    {dayItems.map((item) =>
                      item.kind === 'event' ? (
                        <button
                          key={`e-${item.id}`}
                          type="button"
                          onClick={() => setDialog({ mode: 'edit', item })}
                          className="block w-full truncate rounded bg-orange-100 text-orange-900 hover:bg-orange-200 text-left text-xs px-1 py-0.5"
                          title={item.title}
                        >
                          {!item.allDay && (
                            <span className="font-medium">{timeLabel(new Date(item.date))} </span>
                          )}
                          {item.title}
                        </button>
                      ) : (
                        <Link
                          key={`t-${item.id}`}
                          href={tasksHref}
                          className={`block truncate rounded bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs px-1 py-0.5 ${item.completedAt ? 'line-through opacity-60' : ''}`}
                          title={`Задача: ${item.title}`}
                        >
                          ✅ {item.title}
                        </Link>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[#111111] mb-2">Ближайшие</h3>
        {upcoming.length === 0 ? (
          <p className="text-sm text-gray-400">В этом месяце ничего не запланировано.</p>
        ) : (
          <ul className="space-y-1">
            {upcoming.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="text-sm flex items-baseline gap-2">
                <span className="text-gray-500 tabular-nums shrink-0">
                  {upcomingDateLabel(new Date(item.date))}
                </span>
                {item.kind === 'event' ? (
                  <button
                    type="button"
                    onClick={() => setDialog({ mode: 'edit', item })}
                    className="truncate text-left hover:underline"
                  >
                    {item.title}
                    {item.location ? (
                      <span className="text-gray-400"> · {item.location}</span>
                    ) : null}
                  </button>
                ) : (
                  <Link href={tasksHref} className="truncate hover:underline">
                    ✅ {item.title}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {dialog && (
        <EventDialog
          target={dialog.mode === 'edit' ? dialog.item : null}
          createDate={dialog.mode === 'create' ? dialog.date : null}
          options={options}
          onClose={() => setDialog(null)}
          onSaved={closeSaved}
        />
      )}
    </div>
  );
}
