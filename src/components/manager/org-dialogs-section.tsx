import Link from 'next/link';
import React from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { fmtDateTime } from '@/lib/format';
import { buttonClass } from '@/lib/ui/buttonClass';
import { DIALOG_CHANNEL_LABELS, isDialogChannel } from '@/lib/services/messengers/channels';
import { DIALOG_STATUS_LABELS, isDialogStatus } from '@/lib/services/messengers/dialogStatus';
import type { OrganizationCard } from '@/lib/services/manager/organizationCard';

/**
 * Вкладка «Диалоги» карточки организации (`У-210`).
 *
 * Показывает переписку с людьми этой организации: и диалоги, привязанные к ней
 * самой, и диалоги её контактов. Отвечает на три вопроса (§15): где я —
 * заголовок вкладки; что здесь — подзаголовок; что дальше — ссылка в переписку,
 * а на пустом экране объяснение и кнопка «Написать первым».
 *
 * У администратора ссылки нет: `/manager/*` для него мёртвая дверь (Model A),
 * и подставлять туда ссылку значило бы вести человека в «Доступ запрещён».
 * Поэтому `dialogHref` приходит снаружи и может быть `null` — ровно как у лидов.
 */
export function OrgDialogsSection({
  dialogs,
  dialogHref,
  writeFirstHref,
}: {
  dialogs: OrganizationCard['dialogs'];
  dialogHref: ((id: string) => string) | null;
  writeFirstHref: string | null;
}) {
  if (dialogs.length === 0) {
    return (
      <EmptyState
        icon="💬"
        message="Переписки с этой организацией пока нет. Диалог появится здесь, когда клиент напишет в мессенджер или на почту — либо когда вы напишете ему первым."
        {...(writeFirstHref
          ? {
              action: (
                <Link href={writeFirstHref} className={buttonClass()}>
                  Написать первым
                </Link>
              ),
            }
          : {})}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/*
        Главное действие вкладки видно всегда, а не только на пустом экране
        (§15, «что делать дальше»): переписка есть, но написать нужному
        человеку — отдельное дело, и искать для этого раздел «Мессенджеры»
        человек не должен.
      */}
      {writeFirstHref && (
        <div className="flex justify-end">
          <Link href={writeFirstHref} className={buttonClass({ size: 'sm' })}>
            Написать первым
          </Link>
        </div>
      )}
      <ul className="space-y-2" aria-label="Диалоги организации">
        {dialogs.map((d) => {
          const channel = isDialogChannel(d.channel) ? DIALOG_CHANNEL_LABELS[d.channel] : d.channel;
          const status = isDialogStatus(d.status) ? DIALOG_STATUS_LABELS[d.status] : d.status;
          const who = d.peerDisplay?.trim() || d.peerRef;
          const href = dialogHref?.(d.id) ?? null;
          const title = `${who} · ${channel}`;
          return (
            <li key={d.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {href ? (
                  <Link href={href} className="text-sm font-medium text-[#F97316] hover:underline">
                    {title}
                  </Link>
                ) : (
                  <span className="text-sm font-medium text-[#111111]">{title}</span>
                )}
                <span className="text-xs text-gray-500">{status}</span>
              </div>
              {d.lastMessagePreview && (
                <p className="mt-1 text-sm text-gray-700">{d.lastMessagePreview}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Последнее сообщение: {fmtDateTime(d.lastMessageAt)}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
