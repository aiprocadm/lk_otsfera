import React from 'react';
import Link from 'next/link';
import type { Notification } from '@prisma/client';
import { Badge, EmptyState, Paginator } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import { fmtDateTime } from '@/lib/format';
import { notificationHref, type NotificationRole } from '@/lib/notifications/href';
import {
  NOTIFICATION_TYPES,
  type NotificationRoleKey,
  type NotificationTypeKey,
} from '@/lib/notifications/registry';
import { MarkAllReadButton } from './mark-all-read-button';

/**
 * Страница «Уведомления» — одна на шесть кабинетов (`У-228`, `Р-Э5-1`).
 *
 * Общий компонент оправдан `Р-23`: он строго презентационный, данные и права
 * даёт сервис роли (`listNotificationsPage` со скоупом сессии). Роль здесь
 * влияет только на ссылку строки (`notificationHref`) и адрес раздела.
 *
 * Три вопроса §15: заголовок + крошки (их рисует шелл по реестру меню),
 * подзаголовок в одну строку, главное действие — «Отметить все прочитанными».
 * Пустое состояние объясняет пустоту словами и даёт кнопку (`У-74`).
 */

export type NotificationsScreenProps = {
  role: NotificationRoleKey;
  /** Адрес раздела в кабинете роли — для фильтров, страниц и сброса кэша. */
  basePath: string;
  rows: Notification[];
  total: number;
  unreadTotal: number;
  page: number;
  pageSize: number;
  typeOptions: NotificationTypeKey[];
  /** Применённые фильтры — чтобы подсветить активный и собрать ссылки. */
  unreadOnly: boolean;
  type: NotificationTypeKey | null;
  searchParams: Record<string, string | string[] | undefined>;
  /** Куда ведёт кнопка из пустого состояния. */
  homeHref: string;
};

const SUBTITLE = 'Всё, что произошло по вашим заказам, обращениям и задачам.';
const EMPTY_TEXT =
  'Пока ничего не произошло — здесь появятся события по вашим заказам и обращениям.';

function filterHref(basePath: string, params: { unread?: boolean; type?: string | null }): string {
  const q = new URLSearchParams();
  if (params.unread) q.set('unread', '1');
  if (params.type) q.set('type', params.type);
  const qs = q.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function rowHref(role: NotificationRoleKey, row: Notification): string | null {
  // Слушателю ни один тип не адресован — резолвить нечего.
  if (role === 'student') return null;
  return notificationHref(role as NotificationRole, row.type, row.meta);
}

function typeIcon(type: string): string {
  return (NOTIFICATION_TYPES as Record<string, { icon: string } | undefined>)[type]?.icon ?? '•';
}

function typeLabel(type: string): string {
  return (NOTIFICATION_TYPES as Record<string, { label: string } | undefined>)[type]?.label ?? type;
}

export function NotificationsScreen(props: NotificationsScreenProps) {
  const { basePath, rows, total, unreadTotal, page, pageSize, typeOptions, unreadOnly, type } =
    props;
  const skip = (page - 1) * pageSize;
  const hasFilter = unreadOnly || type !== null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Уведомления"
        subtitle={SUBTITLE}
        action={<MarkAllReadButton basePath={basePath} unreadTotal={unreadTotal} />}
      />

      <nav aria-label="Фильтры уведомлений" className="flex flex-wrap items-center gap-2 text-sm">
        <FilterLink href={filterHref(basePath, { type })} active={!unreadOnly}>
          Все
        </FilterLink>
        <FilterLink href={filterHref(basePath, { unread: true, type })} active={unreadOnly}>
          Непрочитанные{unreadTotal > 0 ? ` (${unreadTotal})` : ''}
        </FilterLink>
        {typeOptions.length > 0 && (
          <label className="ml-auto flex items-center gap-2 text-gray-600">
            <span>Тип</span>
            <TypeSelect
              basePath={basePath}
              unreadOnly={unreadOnly}
              type={type}
              typeOptions={typeOptions}
            />
          </label>
        )}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          icon="🔔"
          title={hasFilter ? 'По этому фильтру ничего нет' : 'Пока тихо'}
          message={hasFilter ? 'Снимите фильтр — и увидите всё, что было.' : EMPTY_TEXT}
          action={
            hasFilter ? (
              <Link href={basePath} className="text-sm text-[#EA580C] hover:underline">
                Показать все уведомления
              </Link>
            ) : (
              <Link href={props.homeHref} className="text-sm text-[#EA580C] hover:underline">
                На главную
              </Link>
            )
          }
        />
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {rows.map((row) => {
            const href = rowHref(props.role, row);
            const body = (
              <>
                <span className="mt-0.5 shrink-0 text-lg" aria-hidden>
                  {typeIcon(row.type)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-sm ${row.isRead ? 'text-gray-700' : 'font-semibold text-[#111111]'}`}
                    >
                      {row.title}
                    </span>
                    {!row.isRead && <Badge tone="warning">новое</Badge>}
                  </span>
                  <span className="block text-sm text-gray-500">{row.body}</span>
                  <span className="mt-1 block text-xs text-gray-400">
                    {typeLabel(row.type)} · {fmtDateTime(row.createdAt)}
                  </span>
                </span>
              </>
            );
            return (
              <li key={row.id} className="flex gap-3 px-4 py-3">
                {href ? (
                  <Link href={href} className="flex min-w-0 flex-1 gap-3 hover:bg-gray-50">
                    {body}
                  </Link>
                ) : (
                  <span className="flex min-w-0 flex-1 gap-3">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {total > pageSize && (
        <Paginator
          basePath={basePath}
          searchParams={props.searchParams}
          take={pageSize}
          skip={skip}
          total={total}
        />
      )}
    </div>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'rounded-full bg-[#F97316] px-3 py-1 text-white'
          : 'rounded-full border border-gray-200 px-3 py-1 text-gray-700 hover:bg-gray-50'
      }
    >
      {children}
    </Link>
  );
}

/**
 * Выбор типа — обычными ссылками, без клиентского состояния: страница
 * серверная, фильтр живёт в адресе, и «назад» в браузере возвращает
 * прежний фильтр.
 */
function TypeSelect({
  basePath,
  unreadOnly,
  type,
  typeOptions,
}: {
  basePath: string;
  unreadOnly: boolean;
  type: NotificationTypeKey | null;
  typeOptions: NotificationTypeKey[];
}) {
  return (
    <span className="flex flex-wrap gap-1">
      <FilterLink href={filterHref(basePath, { unread: unreadOnly })} active={type === null}>
        любой
      </FilterLink>
      {typeOptions.map((key) => (
        <FilterLink
          key={key}
          href={filterHref(basePath, { unread: unreadOnly, type: key })}
          active={type === key}
        >
          {typeIcon(key)} {typeLabel(key)}
        </FilterLink>
      ))}
    </span>
  );
}
