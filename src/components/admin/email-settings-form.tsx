'use client';

import React, { useState } from 'react';
import { saveEmailSettingsAction } from '@/server-actions/admin/integrationSettings';
import { useFormAction, type ActionResult } from '@/lib/ui/useFormAction';

const ERROR_MAP: Record<string, string> = {
  secrets_key_missing:
    'На сервере не задан ключ шифрования (APP_ENCRYPTION_KEY) — секреты сохранять нельзя. Обратитесь к администратору сервера.',
  validation: 'Проверьте заполнение полей.'
};

export function EmailSettingsForm({
  initialEnabled,
  initialFrom,
  apiKeySet,
  apiKeySource
}: {
  initialEnabled: boolean;
  initialFrom: string;
  apiKeySet: boolean;
  apiKeySource: 'db' | 'env' | 'none';
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const { formAction, pending, errorText, success } = useFormAction<Record<string, never>>({
    action: saveEmailSettingsAction as (fd: FormData) => Promise<ActionResult<Record<string, never>>>,
    errorMap: ERROR_MAP,
    refresh: true
  });

  return (
    <form action={formAction} className="space-y-4 bg-white border border-gray-200 rounded-xl p-5">
      <div>
        <h2 className="font-semibold text-[#111111]">Исходящая почта (уведомления)</h2>
        <p className="text-xs text-gray-500 mt-0.5">Отправка через Resend. Ключ хранится в базе в зашифрованном виде.</p>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="email_enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="accent-[#F97316]"
        />
        <span className="text-sm text-[#111111]">Включить отправку писем</span>
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-gray-700 mb-1">Адрес отправителя</span>
        <input
          type="text"
          name="email_from"
          defaultValue={initialFrom}
          placeholder="no-reply@otsfera.ru"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
        />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-gray-700 mb-1">
          API-ключ Resend
          {apiKeySet && (
            <span className="ml-2 text-xs text-green-700">
              задан{apiKeySource === 'env' ? ' (в конфиге сервера)' : ''}
            </span>
          )}
        </span>
        <input
          type="password"
          name="email_resendApiKey"
          autoComplete="off"
          placeholder={apiKeySet ? '•••••••• (оставьте пустым, чтобы не менять)' : 're_...'}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#F97316]"
        />
      </label>

      {errorText && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2" role="alert">
          {errorText}
        </div>
      )}
      {success && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2" role="status">
          Настройки сохранены.
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] disabled:opacity-50"
        >
          {pending ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </form>
  );
}
