'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/ui/toast';
import { fmtDateTime } from '@/lib/format';
import { setFeatureFlagAction } from '@/server-actions/feature-flags';
import type {
  IntegrationHealthRow,
  IntegrationHealthStatus,
} from '@/lib/services/admin/integrationsHealth';

/**
 * Светофор интеграций (`У-70`) и включение каналов (`У-69`).
 *
 * Раньше панель говорила только «Подключено / Не настроено», а результат
 * проверки подключения жил отдельно, ниже по странице. Теперь состояние одно
 * и на виду: работает (с датой проверки) · не настроено · ошибка (с текстом).
 * Канал включается здесь же, где вводятся его ключи, — не через сервер.
 */
const STATUS_VIEW: Record<
  IntegrationHealthStatus,
  { label: string; className: string; hint: string }
> = {
  ok: {
    label: 'работает',
    className: 'bg-green-50 text-green-700 border-green-200',
    hint: 'последняя проверка прошла успешно',
  },
  error: {
    label: 'ошибка',
    className: 'bg-red-50 text-red-700 border-red-200',
    hint: 'последняя проверка не прошла',
  },
  not_configured: {
    label: 'не настроено',
    className: 'bg-gray-100 text-gray-500 border-gray-200',
    hint: 'не хватает ключей или сервис выключен',
  },
  unchecked: {
    label: 'проверка не запускалась',
    className: 'bg-amber-50 text-amber-800 border-amber-200',
    hint: 'ключи заданы, но подключение ещё ни разу не проверяли',
  },
};

const ERRORS_RU: Record<string, string> = {
  forbidden: 'Недостаточно прав',
  unknown_flag: 'Такого канала больше нет — обновите страницу',
  not_editable: 'Этот канал включается на сервере: он проверяется до обращения к базе',
};

export function IntegrationsHealthPanel({ rows }: { rows: IntegrationHealthRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(row: IntegrationHealthRow) {
    /* v8 ignore next -- кнопка рендерится только у строк с переключаемым флагом */
    if (!row.flag) return;
    setBusy(row.key);
    setError(null);
    try {
      const res = await setFeatureFlagAction(row.flag, !row.flagEnabled);
      if (res.ok) {
        toast.success(
          `Канал ${res.enabled ? 'включён' : 'выключен'} — применится в течение минуты`
        );
        router.refresh();
        return;
      }
      setError(ERRORS_RU[res.error] ?? `Ошибка: ${res.error}`);
    } catch {
      setError('Сервер недоступен — попробуйте ещё раз');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
        {rows.map((row) => {
          const view = STATUS_VIEW[row.status];
          return (
            <li
              key={row.key}
              className="px-4 py-3.5 flex flex-wrap items-start gap-3"
              data-testid={`integration-${row.key}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[#111111] text-sm">{row.label}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full border ${view.className}`}
                    title={view.hint}
                    data-testid={`integration-status-${row.key}`}
                  >
                    {view.label}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{row.description}</div>
                {row.lastCheckedAt && (
                  <div className="text-xs text-gray-400 mt-1">
                    Проверено: {fmtDateTime(row.lastCheckedAt)}
                  </div>
                )}
                {row.status === 'error' && row.lastError && (
                  <div
                    className="text-xs text-red-700 mt-1 break-words"
                    data-testid={`integration-error-${row.key}`}
                  >
                    {row.lastError}
                  </div>
                )}
                {row.status === 'unchecked' && (
                  <div className="text-xs text-amber-800 mt-1">
                    Нажмите «Проверить подключение» ниже — иначе неизвестно, отвечает ли сервис.
                  </div>
                )}
              </div>

              {row.flag && (
                <div className="shrink-0">
                  {row.flagEditable ? (
                    <Button
                      size="sm"
                      variant={row.flagEnabled ? 'secondary' : 'primary'}
                      disabled={busy === row.key}
                      onClick={() => void toggle(row)}
                      data-testid={`channel-toggle-${row.key}`}
                    >
                      {row.flagEnabled ? 'Выключить канал' : 'Включить канал'}
                    </Button>
                  ) : (
                    <span
                      className="text-xs text-gray-500"
                      data-testid={`channel-locked-${row.key}`}
                    >
                      включается на сервере
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
