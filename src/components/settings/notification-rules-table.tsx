'use client';

import React, { useState, useTransition } from 'react';
import {
  resetNotificationRulesAction,
  saveNotificationRuleAction,
} from '@/server-actions/admin/notificationRules';
import { toast } from '@/lib/ui/toast';
import type { RuleRow } from '@/lib/notifications/routing';
import type { SettingsCabinet } from '@/lib/navigation/settings';

/**
 * Таблица «событие × роль × канал» (`У-127`).
 *
 * Экран общий для администратора и руководителя (`Р-23`): разметка одна,
 * область действия задаёт сервер по роли. Администратор правит платформу,
 * руководитель — свою компанию.
 *
 * Пометка «изменено» показывает, что значение перекрыто — иначе непонятно,
 * почему у соседней компании то же событие ведёт себя иначе.
 */

const AUDIENCE_RU: Record<string, string> = {
  organization: 'Заказчик',
  partner: 'Партнёр',
  manager: 'Менеджер',
  staff: 'Сотрудники',
  admin: 'Администратор',
};

const CHANNEL_RU: Record<string, string> = {
  email: 'Почта',
  telegram: 'Telegram',
  max: 'Max',
  whatsapp: 'WhatsApp',
};

const CHANNELS = ['email', 'telegram', 'max', 'whatsapp'] as const;

export function NotificationRulesTable({
  cabinet,
  rows,
}: {
  cabinet: SettingsCabinet;
  rows: RuleRow[];
}) {
  const [pending, startTransition] = useTransition();
  // Оптимистичное состояние: переключатель обязан отвечать сразу, иначе
  // человек жмёт второй раз и получает обратное значение.
  const [local, setLocal] = useState<Record<string, boolean>>({});

  const keyOf = (r: Pick<RuleRow, 'eventType' | 'audience' | 'channel'>) =>
    `${r.eventType}|${r.audience}|${r.channel}`;

  // Группируем по паре «событие + роль»: это одна строка таблицы.
  const groups = new Map<string, RuleRow[]>();
  for (const r of rows) {
    const k = `${r.eventType}|${r.audience}`;
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }

  function toggle(row: RuleRow, next: boolean) {
    setLocal((s) => ({ ...s, [keyOf(row)]: next }));
    startTransition(async () => {
      const res = await saveNotificationRuleAction(
        cabinet,
        row.eventType,
        row.audience,
        row.channel,
        next
      );
      if (res.ok) return;
      // Откатываем: показывать включённым то, что не сохранилось, — врать.
      setLocal((s) => ({ ...s, [keyOf(row)]: !next }));
      toast.error(
        res.error === 'company_required'
          ? 'У вашей учётной записи не указана компания — обратитесь к администратору.'
          : 'Не удалось сохранить правило.'
      );
    });
  }

  function resetAll() {
    if (!window.confirm('Вернуть стандартные правила? Ваши изменения будут удалены.')) return;
    startTransition(async () => {
      const res = await resetNotificationRulesAction(cabinet);
      if (res.ok) {
        setLocal({});
        toast.success(
          res.removed === 0
            ? 'Всё и так по умолчанию — менять было нечего.'
            : `Возвращены стандартные правила (снято изменений: ${res.removed}).`
        );
        return;
      }
      toast.error('У вашей учётной записи не указана компания — обратитесь к администратору.');
    });
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <span aria-hidden className="mr-1">
          ℹ️
        </span>
        Уведомление в кабинете (колокольчик) приходит всегда и здесь не отключается: именно эта
        запись не даёт прислать одно и то же письмо дважды.
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={resetAll}
          disabled={pending}
          className="text-xs font-medium text-gray-700 border border-gray-300 hover:border-gray-400 rounded-lg px-3 py-1.5 disabled:opacity-50"
        >
          Вернуть стандартные
        </button>
      </div>

      <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Событие</th>
              <th className="px-4 py-3 text-left font-medium">Кому</th>
              {CHANNELS.map((c) => (
                <th key={c} className="px-4 py-3 text-center font-medium">
                  {CHANNEL_RU[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...groups.entries()].map(([groupKey, cells]) => {
              const first = cells[0]!;
              return (
                <tr key={groupKey} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-[#111111]">{first.eventLabel}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {AUDIENCE_RU[first.audience] ?? first.audience}
                  </td>
                  {CHANNELS.map((channel) => {
                    const cell = cells.find((c) => c.channel === channel);
                    if (!cell) return <td key={channel} className="px-4 py-3" />;
                    const checked = local[keyOf(cell)] ?? cell.enabled;
                    const overridden = cell.source !== 'default';
                    return (
                      <td key={channel} className="px-4 py-3 text-center">
                        <label className="inline-flex flex-col items-center gap-0.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={pending}
                            onChange={(e) => toggle(cell, e.target.checked)}
                            aria-label={`${first.eventLabel} — ${AUDIENCE_RU[first.audience] ?? first.audience} — ${CHANNEL_RU[channel]}`}
                            className="accent-[#F97316] h-4 w-4"
                          />
                          {overridden && (
                            <span className="text-[10px] text-amber-700">
                              {cell.source === 'company' ? 'изменено вами' : 'изменено платформой'}
                            </span>
                          )}
                        </label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
