'use client';
import React, { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClientResource } from '@/hooks/useClientResource';
import { notificationHref, type NotificationRole } from '@/lib/notifications/href';
import { fmtDate } from '@/lib/format';
import { Spinner } from '@/components/ui/spinner';

/**
 * NotificationBell — колокольчик с бейджем непрочитанных и панелью
 * уведомлений (Task C2, parity).
 *
 * Общий для ролей компонент оправдан §4-исключением: строго презентационный,
 * данные приходят из role-scoped API (/api/notifications и /unread — скоуп
 * строит buildNotificationScopeWhere по сессии на сервере); prop `role`
 * влияет только на клиентский резолв href (notificationHref).
 */

/**
 * Узкий локальный row-тип: GET /api/notifications отдаёт полный ряд
 * Notification — типизируем только используемые поля.
 */
type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  meta: unknown;
};

/** Стили пилла скопированы из unread-badge.tsx — существующий паттерн бейджа. */
const PILL_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '20px',
  height: '20px',
  padding: '0 6px',
  borderRadius: '10px',
  backgroundColor: '#F97316',
  color: '#ffffff',
  fontSize: '11px',
  fontWeight: 600,
  lineHeight: 1,
  marginLeft: '4px',
  verticalAlign: 'middle'
};

export function NotificationBell({
  role,
  buttonClassName = 'hover:bg-gray-100'
}: {
  role: NotificationRole;
  /**
   * Hover-подложка кнопки: дефолт заточен под светлый хедер; тёмный хедер
   * partner-шелла передаёт нейтральный вариант (например, hover:bg-white/10).
   */
  buttonClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const unread = useClientResource<number>('/api/notifications/unread', {
    intervalMs: 30_000,
    select: (d) => (d as { count?: number }).count ?? 0
  });
  const list = useClientResource<NotificationRow[]>('/api/notifications', { enabled: open });

  // refetch стабилен (useCallback по url внутри хука) — фиксируем в const,
  // чтобы не тянуть в замыкания объект-результат, меняющий identity.
  const refetchUnread = unread.refetch;
  const refetchList = list.refetch;

  // Закрытие по Escape и клику вне панели — листенеры висят только при open.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Disclosure-паттерн: закрытие с клавиатуры возвращает фокус на кнопку.
      setOpen(false);
      const btn = buttonRef.current;
      /* v8 ignore next -- защитный guard: кнопка смонтирована, пока висят листенеры */
      if (!btn) return;
      btn.focus();
    }
    function onMouseDown(e: MouseEvent) {
      const root = rootRef.current;
      /* v8 ignore next -- защитный guard: пока висят листенеры, обёртка смонтирована */
      if (!root) return;
      if (!root.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  async function markRead(payload: { id: string } | { ids: string[] }) {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch {
      // Best-effort (как unread-badge — молчит): сбой пометки не роняет UI,
      // refetch ниже просто вернёт прежнее состояние.
    }
    refetchList();
    refetchUnread();
  }

  async function handleRowClick(row: NotificationRow) {
    await markRead({ id: row.id });
    const href = notificationHref(role, row.type, row.meta);
    if (href) {
      setOpen(false);
      router.push(href);
    }
  }

  const count = unread.data ?? 0;
  const rows = list.data ?? [];
  const unreadIds = rows.filter((r) => !r.isRead).map((r) => r.id);

  return (
    <div ref={rootRef} className='relative inline-block'>
      <button
        ref={buttonRef}
        type='button'
        aria-label={count > 0 ? `Уведомления, непрочитанных: ${count}` : 'Уведомления'}
        aria-expanded={open}
        aria-haspopup='dialog'
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center rounded-md px-2 py-1 text-lg ${buttonClassName}`}
      >
        <span aria-hidden>🔔</span>
        {count > 0 ? (
          <span aria-hidden style={PILL_STYLE}>
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        // Без role='dialog': репо-правило требует общий <Dialog> для диалогов,
        // но он модальный — здесь немодальный поповер; aria-haspopup='dialog'
        // на кнопке анонсирует тип попапа, aria-controls связывает по id.
        <div
          id={panelId}
          className='absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-2rem))] max-h-[420px] overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg'
        >
          <div className='flex items-center justify-between border-b border-gray-100 px-4 py-2'>
            <span className='text-sm font-medium text-[#111111]'>Уведомления</span>
            {/* Помечает только загруженные 50 строк (GET take:50); при большем числе непрочитанных бейдж останется ненулевым — серверный all:true отложен. */}
            <button
              type='button'
              disabled={unreadIds.length === 0}
              onClick={() => void markRead({ ids: unreadIds })}
              className='text-xs text-[#F97316] hover:underline disabled:text-gray-400 disabled:no-underline'
            >
              Прочитать все
            </button>
          </div>

          {list.loading ? (
            <div className='flex justify-center py-6'>
              <Spinner className='text-gray-400' />
            </div>
          ) : list.error ? (
            <p className='px-4 py-6 text-center text-sm text-gray-500'>Не удалось загрузить</p>
          ) : rows.length === 0 ? (
            <p className='px-4 py-6 text-center text-sm text-gray-500'>Нет уведомлений</p>
          ) : (
            <ul className='divide-y divide-gray-100'>
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type='button'
                    onClick={() => void handleRowClick(row)}
                    className='block w-full px-4 py-3 text-left hover:bg-gray-50'
                  >
                    <span
                      className={`block text-sm ${row.isRead ? 'text-gray-700' : 'font-semibold text-[#111111]'}`}
                    >
                      {row.title}
                    </span>
                    <span className='block text-sm text-gray-500 line-clamp-2'>{row.body}</span>
                    <span className='mt-1 block text-xs text-gray-400'>{fmtDate(row.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
