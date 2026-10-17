'use client';
import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { NOTIFICATION_GROUPS } from '@/lib/notifications/groups';
import { pluralizeRu } from '@/lib/format';

import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import type {
  NotificationPreferenceMatrix,
  PreferenceRow,
} from '@/lib/services/notifications/eventPreferences';
import type { RoutableChannel } from '@/lib/notifications/routing';
import { saveNotificationPreferenceAction } from '@/server-actions/notification-preferences';

/**
 * Матрица «событие × канал» во вкладке «Уведомления» личных настроек
 * (`У-229`, `Р-Э5-4`).
 *
 * Колонки — только каналы, которые у человека есть куда доставлять (почта —
 * всегда). Канал, выключенный правилом компании, показан серым с подсказкой
 * «отключено вашей компанией» — галочку не поставить, а если поставить в
 * обход формы, сервер откажет (`channel_disabled_by_company`).
 *
 * «В кабинете» — отдельная колонка без переключателя: уведомление в кабинете
 * не выключается, и экран говорит об этом прямо, а не прячет колонку.
 */

/** Строки по группам в порядке `NOTIFICATION_GROUPS`; пустые группы не рисуем. */
function groupRows(rows: PreferenceRow[]) {
  return NOTIFICATION_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    rows: rows.filter((r) => r.group === g.key),
  })).filter((g) => g.rows.length > 0);
}

const CHANNEL_LABELS: Record<RoutableChannel, string> = {
  email: 'Почта',
  telegram: 'Telegram',
  max: 'MAX',
  whatsapp: 'WhatsApp',
};

export function NotificationPreferencesMatrix({
  matrix,
}: {
  matrix: NotificationPreferenceMatrix;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyRow, setBusyRow] = useState<string | null>(null);

  function toggle(row: PreferenceRow, key: RoutableChannel, enabled: boolean) {
    const next = row.channels
      .filter((c) => (c.key === key ? enabled : c.enabled))
      .map((c) => c.key);
    setBusyRow(row.eventType);
    startTransition(async () => {
      const res = await saveNotificationPreferenceAction(row.eventType, next);
      setBusyRow(null);
      if (!res.ok) {
        toast.error(errorMessageRu(res.error, 'Не удалось сохранить настройку.'));
        return;
      }
      toast.success(enabled ? 'Канал включён' : 'Канал выключен');
      router.refresh();
    });
  }

  if (matrix.rows.length === 0) {
    return (
      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-[#111111]">По событиям</h2>
        <p className="text-sm text-gray-500">
          Вам пока не адресовано ни одно событие — настраивать нечего.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-[#111111]">По событиям</h2>
        <p className="text-sm text-gray-500">
          Что и куда присылать. Уведомление в кабинете приходит всегда; каналы, которые ваша
          компания выключила, включить нельзя.
        </p>
      </div>
      {/* `У-317`: группы — раскрывающиеся списки узких событий. */}
      {groupRows(matrix.rows).map((group) => (
        <details key={group.key} className="rounded-lg border border-gray-100">
          <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-[#111111]">
            <span>{group.label}</span>
            <span className="text-xs font-normal text-gray-500">
              {group.rows.length}{' '}
              {pluralizeRu(group.rows.length, 'уведомление', 'уведомления', 'уведомлений')}
            </span>
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                  <th className="py-2 pr-3">Событие</th>
                  <th className="px-2 py-2 text-center">В кабинете</th>
                  {matrix.columns.map((key) => (
                    <th key={key} className="px-2 py-2 text-center">
                      {CHANNEL_LABELS[key]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {group.rows.map((row) => (
                  <tr key={row.eventType}>
                    <td className="py-2 pr-3">
                      <span aria-hidden className="mr-1">
                        {row.icon}
                      </span>
                      {row.label}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked
                        disabled
                        aria-label={`${row.label}: в кабинете (всегда)`}
                        title="Уведомление в кабинете не выключается"
                        className="h-4 w-4"
                      />
                    </td>
                    {row.channels.map((cell) => (
                      <td key={cell.key} className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={cell.enabled}
                          disabled={
                            !cell.allowedByCompany || (isPending && busyRow === row.eventType)
                          }
                          aria-label={`${row.label}: ${CHANNEL_LABELS[cell.key]}`}
                          title={cell.allowedByCompany ? undefined : 'Отключено вашей компанией'}
                          onChange={(e) => toggle(row, cell.key, e.target.checked)}
                          className={`h-4 w-4 ${cell.allowedByCompany ? '' : 'opacity-40'}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </section>
  );
}
