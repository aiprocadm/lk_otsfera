import React from 'react';
import Link from 'next/link';
import type { MyDayData } from '@/lib/services/manager/myDay';

/**
 * Этап 11 PR-2 (Модуль 15, ФТ-15.3) — «Мой день».
 *
 * ТЗ просит именно **карточки со ссылками**: каждая цифра ведёт туда, где с ней
 * работают. Карточка с нулём не исчезает (ФТ-15.8) — пустое состояние
 * проговаривается словами, иначе непонятно, «пусто» или «не загрузилось».
 *
 * Компонент презентационный и серверный: состояния нет, данные собирает
 * страница.
 */

function Card({
  title,
  value,
  hint,
  href,
  tone = 'neutral',
  children
}: {
  title: string;
  value: number;
  hint: string;
  href: string;
  tone?: 'neutral' | 'warning' | 'success';
  children?: React.ReactNode;
}) {
  const valueClass =
    value === 0
      ? 'text-gray-300'
      : tone === 'warning'
        ? 'text-[#EA580C]'
        : tone === 'success'
          ? 'text-emerald-600'
          : 'text-[#111111]';
  return (
    <Link
      href={href}
      className='block bg-white border border-gray-200 rounded-xl p-4 hover:border-[#F97316] transition-colors'
    >
      <div className='text-xs font-medium text-gray-500 uppercase tracking-wider'>{title}</div>
      <div className={`mt-1 text-3xl font-semibold ${valueClass}`}>{value}</div>
      <div className='mt-1 text-xs text-gray-500'>{hint}</div>
      {children}
    </Link>
  );
}

export function MyDayCards({ data }: { data: MyDayData }) {
  return (
    <section aria-labelledby='my-day-heading' className='space-y-3'>
      <h2 id='my-day-heading' className='text-sm font-semibold text-[#111111]'>
        Мой день
      </h2>

      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        <Card
          title='Задачи на сегодня'
          value={data.tasksToday}
          hint={data.tasksToday === 0 ? 'На сегодня задач нет' : 'Мои задачи со сроком сегодня'}
          href='/manager/tasks'
        />
        <Card
          title='Просроченные задачи'
          value={data.tasksOverdue}
          tone='warning'
          hint={data.tasksOverdue === 0 ? 'Просроченных нет' : 'Срок уже прошёл'}
          href='/manager/tasks?overdue=1'
        />
        <Card
          title='Поступило'
          value={data.intake}
          hint={
            data.intake === 0
              ? 'Новых обращений и звонков нет'
              : 'Заявки, обращения и звонки без ответственного'
          }
          href='/manager/intake'
        />

        <Card
          title='Готово к передаче'
          value={data.readyToDeliver}
          tone='success'
          hint={
            data.readyToDeliver === 0
              ? 'Готовых к передаче заказов нет'
              : 'Чек-лист закрыт, результат ещё не передан'
          }
          href='/manager/orders'
        >
          {data.readyOrders.length > 0 && (
            <ul className='mt-2 space-y-0.5 text-xs text-gray-600'>
              {data.readyOrders.map((o) => (
                <li key={o.id} className='truncate'>
                  {o.orderNumber ? `№${o.orderNumber} · ` : ''}
                  {o.title}
                </li>
              ))}
              {data.readyTruncated && <li className='text-gray-400'>и другие…</li>}
            </ul>
          )}
        </Card>

        <Card
          title='Мои сделки'
          value={data.dealsOpen}
          hint={data.dealsOpen === 0 ? 'Открытых сделок нет' : 'В работе по стадиям'}
          href='/manager/deals'
        >
          {data.dealsByStage.length > 0 && (
            <ul className='mt-2 space-y-0.5 text-xs text-gray-600'>
              {data.dealsByStage.map((s) => (
                <li key={s.stageName} className='flex justify-between gap-2'>
                  <span className='truncate'>{s.stageName}</span>
                  <span className='text-gray-400'>{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title='Свежие обращения'
          value={data.inboundFresh}
          hint={
            data.inboundFresh === 0 ? 'За сутки новых нет' : 'Пришли за сутки и ещё не разобраны'
          }
          href='/manager/inbox'
        >
          <div className='mt-2 text-xs text-gray-600'>
            Пропущенные звонки за сутки: <span className='font-medium'>{data.callsMissed}</span>
          </div>
        </Card>
      </div>
    </section>
  );
}
