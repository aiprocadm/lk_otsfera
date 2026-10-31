import React from 'react';
import Link from 'next/link';
import type { Notification } from '@prisma/client';
import { Badge, EmptyState, Paginator } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import { fmtDateTime } from '@/lib/format';
import { notificationHref, type NotificationRole } from '@/lib/notifications/href';
import { notificationRoute } from '@/lib/notifications/routes';
import type { NotificationGroupKey, NotificationGroupOption } from '@/lib/notifications/groups';
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
  /**
   * Типы роли по группам, как в настройках (`У-317`, `У-348`); пусто — фильтра
   * типов нет вовсе.
   */
  groupOptions: NotificationGroupOption[];
  /** Применённые фильтры — чтобы подсветить активный и собрать ссылки. */
  unreadOnly: boolean;
  group: NotificationGroupKey | null;
  type: NotificationTypeKey | null;
  searchParams: Record<string, string | string[] | undefined>;
  /** Куда ведёт кнопка из пустого состояния. */
  homeHref: string;
};

type ScreenCopy = { subtitle: string; emptyTitle: string; emptyText: string };

const COPY: ScreenCopy = {
  subtitle: 'Всё, что произошло по вашим заказам, обращениям и задачам.',
  emptyTitle: 'Пока тихо',
  emptyText: 'Пока ничего не произошло — здесь появятся события по вашим заказам и обращениям.',
};

/**
 * Этап 2 ТЗ 13.10.2026 (`У-286`): у слушателя нет заказов и обращений —
 * тексты о них ему не показываются. Подзаголовок и пустое состояние — дословно
 * из протокола ПМ.
 */
const STUDENT_COPY: ScreenCopy = {
  subtitle:
    'Здесь отображаются уведомления о ваших учебных курсах, сроках прохождения обучения и других важных событиях.',
  emptyTitle: 'Пока ничего не произошло',
  emptyText: 'Сюда придут напоминания о назначенных обучениях, их сроках и удостоверениях.',
};

type FilterParams = { unread?: boolean; group?: string | null; type?: string | null };

function filterHref(basePath: string, params: FilterParams): string {
  const q = new URLSearchParams();
  if (params.unread) q.set('unread', '1');
  if (params.group) q.set('group', params.group);
  if (params.type) q.set('type', params.type);
  const qs = q.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function rowHref(role: NotificationRoleKey, row: Notification): string | null {
  // Слушатель: все его типы ведут в «Мой профиль» (`У-286`).
  if (role === 'student') return notificationRoute(row.type, row.meta, 'student');
  return notificationHref(role as NotificationRole, row.type, row.meta);
}

function typeIcon(type: string): string {
  return (NOTIFICATION_TYPES as Record<string, { icon: string } | undefined>)[type]?.icon ?? '•';
}

function typeLabel(type: string): string {
  return (NOTIFICATION_TYPES as Record<string, { label: string } | undefined>)[type]?.label ?? type;
}

export function NotificationsScreen(props: NotificationsScreenProps) {
  const { basePath, rows, total, unreadTotal, page, pageSize, groupOptions, unreadOnly } = props;
  const { group, type } = props;
  const skip = (page - 1) * pageSize;
  const hasFilter = unreadOnly || group !== null || type !== null;
  const copy = props.role === 'student' ? STUDENT_COPY : COPY;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Уведомления"
        subtitle={copy.subtitle}
        action={<MarkAllReadButton basePath={basePath} unreadTotal={unreadTotal} />}
      />

      <nav aria-label="Фильтры уведомлений" className="flex flex-wrap items-center gap-2 text-sm">
        <FilterLink href={filterHref(basePath, { group, type })} active={!unreadOnly}>
          Все
        </FilterLink>
        <FilterLink href={filterHref(basePath, { unread: true, group, type })} active={unreadOnly}>
          Непрочитанные{unreadTotal > 0 ? ` (${unreadTotal})` : ''}
        </FilterLink>
      </nav>
      {groupOptions.length > 0 && (
        <TypeFilter
          basePath={basePath}
          unreadOnly={unreadOnly}
          group={group}
          type={type}
          groupOptions={groupOptions}
        />
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon="🔔"
          title={hasFilter ? 'По этому фильтру ничего нет' : copy.emptyTitle}
          message={hasFilter ? 'Снимите фильтр — и увидите всё, что было.' : copy.emptyText}
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
                    {row.dedupCount > 1 && (
                      <span title={`Повторилось ${row.dedupCount} раз за час`}>
                        <Badge tone="neutral">×{row.dedupCount}</Badge>
                      </span>
                    )}
                  </span>
                  <span className="block text-sm text-gray-500">{row.body}</span>
                  <span className="mt-1 block text-xs text-gray-400">
                    {typeLabel(row.type)} · {fmtDateTime(row.lastOccurredAt ?? row.createdAt)}
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

/**
 * `active` — фильтр применён ровно этой ссылкой (залитая плашка). `current` —
 * ссылка «содержит» применённый фильтр: группа, внутри которой выбран узкий
 * тип, — обведена, чтобы было видно, где находишься.
 */
function FilterLink({
  href,
  active,
  current = false,
  children,
}: {
  href: string;
  active: boolean;
  current?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : current ? 'true' : undefined}
      className={
        active
          ? 'rounded-full bg-[#F97316] px-3 py-1 text-white'
          : current
            ? 'rounded-full border border-[#F97316] px-3 py-1 text-[#EA580C] hover:bg-orange-50'
            : 'rounded-full border border-gray-200 px-3 py-1 text-gray-700 hover:bg-gray-50'
      }
    >
      {children}
    </Link>
  );
}

/**
 * Фильтр типов в два шага (этап 4 ТЗ 28.10.2026, `У-348`): сначала группа — те
 * же «Системные», «Коммуникация», «Задачи», «Заказы», «Заявки на обучение», что
 * в настройках (`У-317`), — потом узкий тип внутри неё. Раньше это был сплошной
 * ряд из всех типов роли (у руководителя — три десятка).
 *
 * Ряд групп не рисуется, когда группа у роли одна (у слушателя — только
 * обучение): выбирать из одного нечего, сразу видны типы.
 *
 * Всё — обычными ссылками, без клиентского состояния: страница серверная,
 * фильтр живёт в адресе, и «назад» в браузере возвращает прежний фильтр.
 */
function TypeFilter({
  basePath,
  unreadOnly,
  group,
  type,
  groupOptions,
}: {
  basePath: string;
  unreadOnly: boolean;
  group: NotificationGroupKey | null;
  type: NotificationTypeKey | null;
  groupOptions: NotificationGroupOption[];
}) {
  const single = groupOptions.length === 1 ? groupOptions[0] : undefined;
  const open = single ?? groupOptions.find((g) => g.key === group);
  return (
    <div className="space-y-2 text-sm">
      {!single && (
        <nav aria-label="Группа уведомлений" className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-gray-600">Группа</span>
          <FilterLink href={filterHref(basePath, { unread: unreadOnly })} active={group === null}>
            любая
          </FilterLink>
          {groupOptions.map((g) => (
            <FilterLink
              key={g.key}
              href={filterHref(basePath, { unread: unreadOnly, group: g.key })}
              active={group === g.key && type === null}
              current={group === g.key}
            >
              {g.label}
            </FilterLink>
          ))}
        </nav>
      )}
      {open && (
        <nav
          aria-label={`Типы уведомлений: ${open.label}`}
          className="flex flex-wrap items-center gap-1"
        >
          <span className="mr-1 text-gray-600">Тип</span>
          <FilterLink
            href={filterHref(basePath, { unread: unreadOnly, group: single ? null : open.key })}
            active={type === null}
          >
            {single ? 'любой' : `все «${open.label}»`}
          </FilterLink>
          {open.types.map((key) => (
            <FilterLink
              key={key}
              href={filterHref(basePath, {
                unread: unreadOnly,
                group: single ? null : open.key,
                type: key,
              })}
              active={type === key}
            >
              {typeIcon(key)} {typeLabel(key)}
            </FilterLink>
          ))}
        </nav>
      )}
    </div>
  );
}
