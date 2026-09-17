import React from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import type { CabinetDialogRow } from '@/lib/services/cabinetDialogs/list';
import type { CabinetDialogView } from '@/lib/services/cabinetDialogs/get';
import { CabinetReplyForm } from './cabinet-reply-form';

/**
 * «Переписка с менеджером» (`У-234`) — один экран на кабинет заказчика и
 * партнёра (`Р-23`: компонент презентационный, данные и права даёт сервис
 * роли).
 *
 * Слева список переписок всех каналов, справа выбранная. Выбор — обычной
 * ссылкой `?dialog=`, без JS: экран серверный, а переписка должна открываться
 * по ссылке из письма и уведомления.
 *
 * Поле ответа стоит всегда: даже когда переписки ещё нет, человек должен
 * видеть, что делать дальше (`У-74`), — написать первым.
 */
export function CabinetDialogsPanel({
  basePath,
  query,
  dialogs,
  selected,
}: {
  basePath: string;
  /** Хвост адреса (активная организация) — ссылки не должны уводить в другую. */
  query?: Record<string, string> | undefined;
  dialogs: CabinetDialogRow[];
  /** Открытая переписка; `null` — ни одной ещё нет или выбранная недоступна. */
  selected: CabinetDialogView | null;
}) {
  function dialogHref(id: string): string {
    const params = new URLSearchParams({ ...(query ?? {}), tab: 'manager', dialog: id });
    return `${basePath}?${params.toString()}`;
  }

  const hint =
    selected && !selected.isCabinet
      ? `Ответ уйдёт в переписку кабинета — менеджер увидит его там же. Ответить можно и в «${selected.channelLabel}».`
      : undefined;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <section className="space-y-2" data-testid="cabinet-dialogs-list">
        <h2 className="text-sm font-medium uppercase tracking-wider text-gray-500">Переписки</h2>
        {dialogs.length === 0 ? (
          // Пустое состояние — общим примитивом (`У-74`): главное действие рядом,
          // поле «Написать менеджеру» стоит ниже на том же экране.
          <EmptyState
            icon="💬"
            title="Переписки пока нет"
            message="Напишите менеджеру — ответ придёт сюда и в уведомления."
            className="p-6"
          />
        ) : (
          <ul className="space-y-2">
            {dialogs.map((d) => {
              const isActive = selected?.id === d.id;
              return (
                <li key={d.id}>
                  <Link
                    href={dialogHref(d.id)}
                    data-testid={`cabinet-dialog-${d.id}`}
                    aria-current={isActive ? 'true' : undefined}
                    className={`block rounded-xl border p-3 transition-colors ${
                      isActive
                        ? 'border-[#F97316] bg-[#FFF7ED]'
                        : 'border-gray-200 bg-white hover:border-[#F97316]'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-[#111111]">{d.channelLabel}</span>
                      <span className="flex-shrink-0 text-xs text-gray-500">
                        {fmtDateTime(d.lastMessageAt)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-600">
                      {d.preview
                        ? `${d.lastDirection === 'out' ? 'Менеджер: ' : d.lastDirection === 'in' ? 'Вы: ' : ''}${d.preview}`
                        : 'Нет новых сообщений'}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3" data-testid="cabinet-dialog-thread">
        {selected ? (
          <>
            <h2 className="text-sm font-medium uppercase tracking-wider text-gray-500">
              {selected.channelLabel}
            </h2>
            {selected.hiddenCount > 0 && (
              <p className="text-xs text-gray-500">
                Показаны последние сообщения; ещё {selected.hiddenCount} выше по переписке.
              </p>
            )}
            {selected.messages.length === 0 ? (
              <EmptyState
                icon="💬"
                title="Сообщений пока нет"
                message="Напишите первым — ответ менеджера появится здесь."
                className="p-6"
              />
            ) : (
              <ol className="space-y-2">
                {selected.messages.map((m) => (
                  <li
                    key={m.id}
                    data-testid={`cabinet-message-${m.id}`}
                    className={
                      m.direction === 'out'
                        ? 'max-w-[85%] rounded-xl border border-gray-200 bg-white p-3'
                        : 'ml-auto max-w-[85%] rounded-xl border border-[#F97316]/40 bg-[#FFF7ED] p-3'
                    }
                  >
                    <div className="text-xs text-gray-500">
                      {m.direction === 'out' ? 'Менеджер' : 'Вы'} · {fmtDateTime(m.createdAt)}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{m.body}</div>
                    {m.attachmentName && (
                      <div className="mt-1 text-xs text-gray-500">📎 {m.attachmentName}</div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-600">
            Выберите переписку слева или напишите менеджеру — новая переписка появится здесь.
          </p>
        )}
        <CabinetReplyForm hint={hint} />
      </section>
    </div>
  );
}
