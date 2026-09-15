import Link from 'next/link';
import React from 'react';
import { DIALOG_CHANNEL_LABELS, isDialogChannel } from '@/lib/services/messengers/channels';
import { DIALOG_STATUS_LABELS, isDialogStatus } from '@/lib/services/messengers/dialogStatus';
import type { OrderDialogRow } from '@/lib/services/messengers/forOrder';

/**
 * Блок «Переписка с клиентом» в карточке заказа (`У-210`).
 *
 * Отвечает на вопрос «о чём мы с ними уже говорили», не заставляя уходить в
 * раздел «Мессенджеры» и искать человека там. Показывает несколько свежих
 * диалогов контакта заказа и его организации.
 *
 * Пустое состояние с действием (`У-74`): если переписки нет, а контакт у
 * заказа есть — предлагаем написать ему первым. Если контакта нет, честно
 * говорим, что сначала нужно указать контакт: иначе кнопка вела бы в пустую
 * форму, где некого выбрать.
 *
 * `dialogHref` и `writeFirstHref` приходят снаружи и равны `null` у
 * администратора: раздел «Мессенджеры» живёт под `/manager/*` (Model A).
 */
export function OrderDialogsPanel({
  dialogs,
  total,
  dialogHref,
  writeFirstHref,
  allHref,
  hasContact,
}: {
  dialogs: OrderDialogRow[];
  /** Всего диалогов — чтобы сказать «показаны N из M», а не обрезать молча. */
  total: number;
  dialogHref: ((id: string) => string) | null;
  writeFirstHref: string | null;
  /** Куда вести за всей перепиской — вкладка «Диалоги» карточки организации. */
  allHref: string | null;
  hasContact: boolean;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
      <div>
        <h2 className="text-sm font-semibold text-[#111111]">Переписка с клиентом</h2>
        <p className="text-xs text-gray-500">
          Диалоги с контактом заказа и его организацией — в мессенджерах и по почте.
        </p>
      </div>

      {dialogs.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">
            {hasContact
              ? 'Переписки пока нет.'
              : 'Переписки пока нет: у заказа не указан контакт, поэтому связать разговор не с кем.'}
          </p>
          {hasContact && writeFirstHref && (
            <Link
              href={writeFirstHref}
              className="text-sm font-medium text-[#F97316] hover:underline"
            >
              Написать первым
            </Link>
          )}
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Диалоги по заказу">
          {dialogs.map((d) => {
            const channel = isDialogChannel(d.channel)
              ? DIALOG_CHANNEL_LABELS[d.channel]
              : d.channel;
            const status = isDialogStatus(d.status) ? DIALOG_STATUS_LABELS[d.status] : d.status;
            const href = dialogHref?.(d.id) ?? null;
            const title = `${d.peerLabel} · ${channel}`;
            return (
              <li key={d.id} className="border-t border-gray-100 pt-2 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {href ? (
                    <Link
                      href={href}
                      className="text-sm font-medium text-[#F97316] hover:underline"
                    >
                      {title}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-[#111111]">{title}</span>
                  )}
                  <span className="text-xs text-gray-500">{status}</span>
                </div>
                {d.lastMessagePreview && (
                  <p className="mt-0.5 text-xs text-gray-600">{d.lastMessagePreview}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {dialogs.length > 0 && total > dialogs.length && (
        <p className="text-xs text-gray-500">
          Показаны последние {dialogs.length} из {total}.{' '}
          {allHref && (
            <Link href={allHref} className="font-medium text-[#F97316] hover:underline">
              Вся переписка организации
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
