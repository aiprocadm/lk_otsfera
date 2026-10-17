import React from 'react';
import Link from 'next/link';
import type { MyDayData } from '@/lib/services/manager/myDay';
import { ORDER_FOCUS_LABEL, orderFocusHref } from '@/lib/orders/focus';

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
  children,
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
      className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-[#F97316] transition-colors"
    >
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">{title}</div>
      <div className={`mt-1 text-3xl font-semibold ${valueClass}`}>{value}</div>
      <div className="mt-1 text-xs text-gray-500">{hint}</div>
      {children}
    </Link>
  );
}

export function MyDayCards({ data }: { data: MyDayData }) {
  return (
    <section aria-labelledby="my-day-heading" className="space-y-3">
      <h2 id="my-day-heading" className="text-sm font-semibold text-[#111111]">
        Мой день
      </h2>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          title="Задачи на сегодня"
          value={data.tasksToday}
          hint={data.tasksToday === 0 ? 'На сегодня задач нет' : 'Мои задачи со сроком сегодня'}
          href="/manager/tasks"
        />
        <Card
          title="Просроченные задачи"
          value={data.tasksOverdue}
          tone="warning"
          hint={data.tasksOverdue === 0 ? 'Просроченных нет' : 'Срок уже прошёл'}
          href="/manager/tasks?overdue=1"
        />
        {/* Этап 4 ТЗ 13.10.2026 (`У-293`, `У-294`): «Поступило» и «Свежие
            обращения» — одна карточка: вся очередь «Входящие обращения» (`У-318`) и сроки
            ответа по ней. */}
        <Card
          title="Свежие обращения"
          value={data.intake}
          tone={data.intakeOverdue > 0 ? 'warning' : 'neutral'}
          hint={
            data.intake === 0
              ? 'Неотвеченных обращений нет'
              : 'Обращения, заявки, письма и звонки без ответа'
          }
          href="/manager/intake"
        >
          <ul className="mt-2 space-y-0.5 text-xs text-gray-600" data-testid="intake-sla">
            <li className="flex justify-between gap-2">
              <span>Остался 1 час на ответ</span>
              <span className="font-medium">{data.intakeDueWithinHour}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Просрочено</span>
              <span
                className={data.intakeOverdue > 0 ? 'font-medium text-[#EA580C]' : 'font-medium'}
              >
                {data.intakeOverdue}
              </span>
            </li>
          </ul>
        </Card>

        {/* `У-295`: переход — в «Заказы» с тем же фильтром, число = строки. */}
        <Card
          title={ORDER_FOCUS_LABEL.ready}
          value={data.readyToDeliver}
          tone="success"
          hint={
            data.readyToDeliver === 0
              ? 'Готовых к передаче заказов нет'
              : 'Чек-лист закрыт, результат ещё не передан'
          }
          href={orderFocusHref('ready')}
        >
          {data.readyOrders.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
              {data.readyOrders.map((o) => (
                <li key={o.id} className="truncate">
                  {o.orderNumber ? `№${o.orderNumber} · ` : ''}
                  {o.title}
                </li>
              ))}
              {data.readyTruncated && <li className="text-gray-400">и другие…</li>}
            </ul>
          )}
        </Card>

        <Card
          title="Мои сделки"
          value={data.dealsOpen}
          hint={data.dealsOpen === 0 ? 'Открытых сделок нет' : 'В работе по стадиям'}
          href="/manager/deals"
        >
          {data.dealsByStage.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
              {data.dealsByStage.map((s) => (
                <li key={s.stageName} className="flex justify-between gap-2">
                  <span className="truncate">{s.stageName}</span>
                  <span className="text-gray-400">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* `У-226` (этап 4 ТЗ 12.09.2026): вещи, которых в сводке не хватало. Экран
            остался одним — новые карточки встали рядом, а не отдельным блоком:
            «Мой день» отвечает на один вопрос «чем заняться сейчас». */}
        <Card
          title="Ждут моего ответа"
          value={data.dialogsWaiting}
          tone={data.dialogsWaiting > 0 ? 'warning' : 'neutral'}
          hint={
            data.dialogsWaiting === 0
              ? 'Все мои переписки с ответом'
              : 'Клиент написал, а я ещё не ответил'
          }
          href="/manager/messengers?status=waiting_staff"
        />
        <Card
          title="КП с истекающим сроком"
          value={data.proposalsExpiring}
          tone={data.proposalsExpiring > 0 ? 'warning' : 'neutral'}
          hint={
            data.proposalsExpiring === 0
              ? 'Срочных предложений нет'
              : 'Срок действия кончается в ближайшие дни'
          }
          href="/manager/documents"
        />
        {/* `У-296`: «Шагов в чек-листах» убрано — шаги несопоставимы по
            объёму, их число ничего не говорит. */}
        <Card
          title="События сегодня"
          value={data.eventsToday}
          hint={data.eventsToday === 0 ? 'Встреч на сегодня нет' : 'Мои события календаря'}
          href="/manager/calendar"
        />
      </div>
    </section>
  );
}
