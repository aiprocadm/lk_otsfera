'use client';

import React, { useTransition } from 'react';
import { useFormAction, type ActionResult } from '@/lib/ui/useFormAction';
import { sendTestAlertAction } from '@/server-actions/admin/alerts';
import { toast } from '@/lib/ui/toast';

/**
 * «Здоровье системы → Оповещения» (`У-126`).
 *
 * Пороги и канал доставки правились только в конфиге сервера: чтобы перестать
 * получать ложный алерт «очередь длиннее ста задач», требовалась выкладка.
 *
 * Тестовая отправка идёт **тем же путём**, что настоящее оповещение — иначе
 * она проверяла бы саму себя, а не доставку.
 */

const ERROR_MAP: Record<string, string> = {
  value_out_of_range: 'Значение вне допустимых границ — проверьте пороги.',
  validation: 'Проверьте список адресов: похоже, где-то опечатка.',
  secrets_key_missing: 'На сервере не задан ключ шифрования — токен сохранить нельзя.',
};

const inputClass =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]';

export type AlertSettingsValues = {
  queueWaitingMax: string;
  dlqMax: string;
  syncLagMaxHours: string;
  renotifyCooldownHours: string;
  oneCDeadLetterMax: string;
  oneCPushFailedMax: string;
  telegramChatId: string;
  emailRecipients: string;
};

export function AlertSettingsForm({
  initial,
  telegramTokenSet,
  action,
}: {
  initial: AlertSettingsValues;
  telegramTokenSet: boolean;
  action: (fd: FormData) => Promise<ActionResult<object>>;
}) {
  const { formAction, pending, errorText, success } = useFormAction({
    action,
    errorMap: ERROR_MAP,
    refresh: true,
  });
  const [testing, startTest] = useTransition();

  function sendTest() {
    startTest(async () => {
      const res = await sendTestAlertAction();
      if (res.ok) {
        toast.success('Тестовое оповещение отправлено — проверьте почту и чат.');
        return;
      }
      toast.error('Не удалось отправить. Проверьте токен бота и адрес чата.');
    });
  }

  const numbers: Array<{ name: keyof AlertSettingsValues; label: string; hint: string }> = [
    {
      name: 'queueWaitingMax',
      label: 'Задач в очереди — тревожный предел',
      hint: 'по умолчанию 100',
    },
    { name: 'dlqMax', label: 'Упавших задач — тревожный предел', hint: 'по умолчанию 0' },
    {
      name: 'syncLagMaxHours',
      label: 'Обмен молчит дольше, часов',
      hint: 'по умолчанию 24',
    },
    {
      name: 'renotifyCooldownHours',
      label: 'Не напоминать об одном и том же, часов',
      hint: 'по умолчанию 6',
    },
    {
      name: 'oneCDeadLetterMax',
      label: 'Записей 1С в «мёртвой» очереди — предел',
      hint: 'по умолчанию 0',
    },
    // `У-174`: выше предела светофор 1С желтеет и уходит оповещение.
    {
      name: 'oneCPushFailedMax',
      label: 'Документов не выгружено в 1С — предел',
      hint: 'по умолчанию 0',
    },
  ];

  return (
    <form
      action={formAction}
      className="bg-white border border-gray-200 rounded-xl p-5 space-y-3"
      data-testid="alert-settings-form"
    >
      <div>
        <h2 className="text-sm font-semibold text-[#111111]">Оповещения</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Когда предупреждать о неполадках и куда отправлять сообщение.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {numbers.map((n) => (
          <label key={n.name} className="block text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">{n.label}</span>
            <input
              type="text"
              name={`alerts_${n.name}`}
              defaultValue={initial[n.name]}
              placeholder={n.hint}
              disabled={pending}
              className={inputClass}
            />
          </label>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-gray-700">
          <span className="block text-xs text-gray-500 mb-1">
            Токен Telegram-бота
            {telegramTokenSet && <span className="ml-2 text-green-700">задан</span>}
          </span>
          <input
            type="password"
            name="alerts_telegramBotToken"
            autoComplete="off"
            placeholder={telegramTokenSet ? '•••••••• (пусто — не менять)' : '123456:ABC-…'}
            disabled={pending}
            className={`${inputClass} font-mono`}
          />
        </label>
        <label className="block text-sm text-gray-700">
          <span className="block text-xs text-gray-500 mb-1">Чат для оповещений</span>
          <input
            type="text"
            name="alerts_telegramChatId"
            defaultValue={initial.telegramChatId}
            placeholder="-1001234567890"
            disabled={pending}
            className={`${inputClass} font-mono`}
          />
        </label>
      </div>

      <label className="block text-sm text-gray-700">
        <span className="block text-xs text-gray-500 mb-1">
          Кому писать на почту (через запятую)
        </span>
        <input
          type="text"
          name="alerts_emailRecipients"
          defaultValue={initial.emailRecipients}
          placeholder="Пусто — всем администраторам"
          disabled={pending}
          className={inputClass}
        />
      </label>

      <p className="text-xs text-gray-400">
        Пустое поле означает «взять значение сервера, а если и там пусто — стандартное».
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] disabled:opacity-50"
        >
          {pending ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button
          type="button"
          onClick={sendTest}
          disabled={testing || pending}
          className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 hover:border-gray-400 rounded-lg disabled:opacity-50"
        >
          {testing ? 'Отправляем…' : 'Отправить тестовое оповещение'}
        </button>
        {success && (
          <span role="status" className="text-sm text-green-700">
            Сохранено.
          </span>
        )}
      </div>

      {errorText && (
        <p role="alert" className="text-sm text-red-600">
          {errorText}
        </p>
      )}
    </form>
  );
}
