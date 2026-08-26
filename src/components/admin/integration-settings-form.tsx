'use client';

import React, { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormAction, resolveErrorText, type ActionResult } from '@/lib/ui/useFormAction';
import { ResetSettingButton } from './reset-setting-button';
import { WebhookSecretControls } from './webhook-secret-controls';

/**
 * Генерик-форма группы настроек интеграций на /admin/integrations
 * (спека 2026-07-22-integration-settings-wave2 §4). Каждая группа (Telegram /
 * Max / WhatsApp / Mango / IMAP) — свой server-action; поля декларативные.
 * Секрет: значение никогда не приходит с сервера — только факт «задан»;
 * пустое поле при сохранении не затирает сохранённый секрет.
 *
 * PR-2 этапа 1 (спека §5–6): панель «Проверить подключение» (universal probe
 * по админ-конфигу, результат в SyncState) + блок диагностики вебхука.
 */

export type IntegrationFormField = {
  /** name инпута — его же читает server-action из FormData. */
  name: string;
  label: string;
  kind: 'text' | 'secret' | 'checkbox' | 'select';
  /** Начальное значение для text/select. */
  initialValue?: string;
  /** Начальное состояние для checkbox. */
  initialChecked?: boolean;
  placeholder?: string;
  /** Варианты для select. */
  options?: { value: string; label: string }[];
  /** Секрет: задан ли (в БД или env). */
  secretSet?: boolean;
  /** Источник секрета — чтобы показать «в конфиге сервера» для env. */
  secretSource?: 'db' | 'env' | 'none';
  /**
   * Ключ настройки в реестре. Нужен кнопке «использовать значение сервера»
   * (`У-131`): без него сбрасывать нечего, поэтому поле необязательное.
   */
  settingKey?: string;
  /**
   * Источник ЛЮБОГО (не только секретного) значения. Кнопка сброса появляется
   * только при `'db'` — то есть когда заданное здесь значение действительно
   * перекрывает серверное.
   */
  source?: 'db' | 'env' | 'none';
};

const ERROR_MAP: Record<string, string> = {
  secrets_key_missing:
    'На сервере не задан ключ шифрования (APP_ENCRYPTION_KEY) — секреты сохранять нельзя. Обратитесь к администратору сервера.',
  validation: 'Проверьте заполнение полей.',
};

const inputClass =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]';

/** Итог последней пробы подключения (SyncState `integration.<key>`), даты отформатированы на сервере. */
export type IntegrationCheckInfo = {
  lastAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
};

/** Диагностика вебхука (SyncState `webhook.<name>`): подсказка регистрации + последнее входящее. */
export type WebhookDiagInfo = {
  url: string;
  /**
   * Ключ провайдера для действий с секретом (`У-123`). Необязательный: у
   * провайдера без генерируемого нами секрета (Mango — `apiSalt` выдаёт он
   * сам) кнопок быть не должно.
   */
  provider?: string | undefined;
  /** Есть ли у провайдера API регистрации вебхука. */
  canRegister?: boolean | undefined;
  /** Имя секрет-заголовка; null — аутентификация не заголовком (например подпись Mango). */
  headerName: string | null;
  secretSet: boolean;
  lastEventAt: string | null;
  note?: string | undefined;
};

export type IntegrationTestAction = (
  fd: FormData
) => Promise<{ ok: true; success: boolean; message: string } | { ok: false; error: string }>;

/**
 * Панель «Проверить подключение» + диагностика вебхука. Рендерится ВНУТРИ
 * <form> карточки: кнопка использует formAction-override, поэтому клик не
 * сохраняет настройки, а зовёт пробу. После пробы — router.refresh(), чтобы
 * строка «последняя проверка» перечиталась из SyncState.
 */
export function IntegrationCheckPanel({
  testAction,
  check,
  webhook,
}: {
  testAction: IntegrationTestAction;
  check: IntegrationCheckInfo | null;
  webhook?: WebhookDiagInfo | null | undefined;
}) {
  const router = useRouter();
  const [result, testFormAction, testPending] = useActionState<
    { success: boolean; message: string } | null,
    FormData
  >(async (_prev, fd) => {
    const r = await testAction(fd);
    if (!r.ok) return { success: false, message: resolveErrorText(r.error, ERROR_MAP) };
    router.refresh();
    return { success: r.success, message: r.message };
  }, null);

  return (
    <div className="border-t border-gray-100 pt-3 space-y-2">
      {webhook && (
        <div className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 space-y-1">
          <div className="font-medium text-gray-700">Вебхук (приём входящих событий)</div>
          <div>
            Адрес для регистрации: <span className="font-mono break-all">{webhook.url}</span>
          </div>
          {webhook.headerName && (
            <div>
              Секрет-заголовок: <span className="font-mono">{webhook.headerName}</span>{' '}
              {webhook.secretSet ? (
                <span className="text-green-700">задан</span>
              ) : (
                <span className="text-amber-700">не задан</span>
              )}
            </div>
          )}
          {webhook.note && <div>{webhook.note}</div>}
          <div>Последнее входящее: {webhook.lastEventAt ?? '—'}</div>
          {/* `У-123`: секрет генерируется здесь, а не задаётся на сервере. */}
          {webhook.provider && (
            <WebhookSecretControls
              provider={webhook.provider}
              canRegister={webhook.canRegister ?? false}
            />
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-gray-500">
          Последняя проверка:{' '}
          {check?.lastAt ? (
            <>
              {check.lastAt} —{' '}
              {check.lastOk ? (
                <span className="text-green-700">успешно</span>
              ) : (
                <span className="text-red-700">{check.lastError ?? 'ошибка'}</span>
              )}
            </>
          ) : (
            '—'
          )}
        </div>
        <button
          type="submit"
          formAction={testFormAction}
          disabled={testPending}
          className="px-3 py-1.5 border border-[#F97316] text-[#F97316] text-sm rounded-lg hover:bg-orange-50 disabled:opacity-50"
        >
          {testPending ? 'Проверяем…' : 'Проверить подключение'}
        </button>
      </div>

      {result && (
        <div
          role={result.success ? 'status' : 'alert'}
          className={
            result.success
              ? 'text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2'
              : 'text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2'
          }
        >
          {result.message}
        </div>
      )}
    </div>
  );
}

export function IntegrationSettingsForm({
  title,
  description,
  note,
  action,
  fields,
  testAction,
  check,
  webhook,
}: {
  title: string;
  description: string;
  /** Плашка-примечание (например, про env-флаг включения канала). */
  note?: string;
  action: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
  fields: IntegrationFormField[];
  /** «Проверить подключение» (ФТ-14.3); без него панель проверки не рендерится. */
  testAction?: IntegrationTestAction;
  check?: IntegrationCheckInfo | null;
  webhook?: WebhookDiagInfo | null;
}) {
  const { formAction, pending, errorText, success } = useFormAction<Record<string, never>>({
    action: action as (fd: FormData) => Promise<ActionResult<Record<string, never>>>,
    errorMap: ERROR_MAP,
    refresh: true,
  });

  return (
    <form action={formAction} className="space-y-4 bg-white border border-gray-200 rounded-xl p-5">
      <div>
        <h2 className="font-semibold text-[#111111]">{title}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>

      {note && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          {note}
        </div>
      )}

      {fields.map((f) =>
        f.kind === 'checkbox' ? (
          <label key={f.name} className="flex items-center gap-2">
            <input
              type="checkbox"
              name={f.name}
              defaultChecked={f.initialChecked}
              className="accent-[#F97316]"
            />
            <span className="text-sm text-[#111111]">{f.label}</span>
          </label>
        ) : (
          <label key={f.name} className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              {f.label}
              {f.kind === 'secret' && f.secretSet && (
                <span className="ml-2 text-xs text-green-700">
                  задан{f.secretSource === 'env' ? ' (в конфиге сервера)' : ''}
                </span>
              )}
              {/* `У-131`: сбросить можно только то, что реально перекрыто. */}
              {f.settingKey && (f.source ?? f.secretSource) === 'db' && (
                <ResetSettingButton settingKey={f.settingKey} label={f.label} />
              )}
            </span>
            {f.kind === 'select' ? (
              <select name={f.name} defaultValue={f.initialValue} className={inputClass}>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.kind === 'secret' ? (
              <input
                type="password"
                name={f.name}
                autoComplete="off"
                placeholder={
                  f.secretSet ? '•••••••• (оставьте пустым, чтобы не менять)' : f.placeholder
                }
                className={`${inputClass} font-mono`}
              />
            ) : (
              <input
                type="text"
                name={f.name}
                defaultValue={f.initialValue}
                placeholder={f.placeholder}
                className={inputClass}
              />
            )}
          </label>
        )
      )}

      {errorText && (
        <div
          className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2"
          role="alert"
        >
          {errorText}
        </div>
      )}
      {success && (
        <div
          className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2"
          role="status"
        >
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

      {testAction && (
        <IntegrationCheckPanel testAction={testAction} check={check ?? null} webhook={webhook} />
      )}
    </form>
  );
}
