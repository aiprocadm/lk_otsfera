'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/lib/ui/toast';
import { setFeatureFlagAction } from '@/server-actions/feature-flags';
import type { FeatureFlag } from '@/lib/featureFlags';
import type { FeatureFlagRow, FlagSource } from '@/lib/services/admin/featureFlags';

/**
 * Матрица feature-флагов на `/admin/settings/system/feature-flags`.
 *
 * До этапа 8 экран был только для чтения: значения жили в переменных
 * окружения, и включить функцию можно было лишь через сервер. Теперь
 * поведенческие флаги переключаются здесь (`У-65`), у каждого видно, откуда
 * взято значение (`У-66`), переключение пишется в журнал (`У-67`), а опасные
 * спрашивают подтверждение с текстом последствия (`У-68`).
 *
 * Флаги, закрывающие целые разделы, остаются за сервером и показаны только для
 * чтения: они читаются в edge-среде, где базы нет, и переключатель создавал бы
 * иллюзию управления. Запрет держится и на сервере (сервис), а не только тем,
 * что кнопки нет.
 *
 * `Record<FeatureFlag, string>` — намеренно exhaustive: новый флаг без описания
 * ломает typecheck и не может молча выпасть из матрицы.
 */
const FLAG_LABELS: Record<FeatureFlag, string> = {
  client_requests: 'Обращения клиентов: подача и триаж',
  commission_pdf: 'Скачивание PDF-стейтмента комиссии',
  commission_xlsx: 'Скачивание XLSX-стейтмента комиссии',
  pwa_installer: 'Подсказка установки приложения (PWA)',
  organization_cabinet: 'Кабинет организации',
  manager_cabinet: 'Кабинет менеджера',
  leader_cabinet: 'Кабинет руководителя',
  chat: 'Чат с клиентами (partner/org) и чат-секция менеджера',
  enrollment_requests: 'Заявки на обучение',
  max_channel: 'Канал уведомлений Max',
  whatsapp_channel: 'Канал уведомлений WhatsApp (агрегатор)',
  notif_queue: 'Доставка уведомлений через воркер (очередь)',
  role_constructor: 'Конструктор ролей',
  sales_funnel: 'Воронка продаж / канбан',
  leader_analytics: 'Аналитика руководителя (план/факт)',
  internal_tasks: 'Внутренние задачи / канбан',
  inbound_messaging: 'Омниканальный инбокс входящих сообщений',
  telephony_mango: 'Телефония Mango (звонки, записи)',
  staff_2fa: '2FA сотрудников (код на почту при входе)',
  pii_access_log: 'Журнал доступа сотрудников к персональным данным',
  contacts: 'Справочник контактов и карточки',
  staff_chat: 'Внутренний чат сотрудников',
  staff_calendar: 'Календарь сотрудников',
  global_search: 'Глобальный поиск (сотрудники)',
  certificates_registry: 'Реестры удостоверений клиентов (организация/партнёр)',
  deals_pipeline: 'Сделки / канбан менеджера и руководителя',
  intake_inbox: 'Входящие в работу: единый триаж-экран',
  document_generation: 'Генерация счёта/акта по заказу',
  cabinet_questions: '«Задать вопрос» из кабинета клиента',
  settings_hub: 'Единый хаб «Настройки» в кабинетах сотрудников',
};

/**
 * `У-68`: текст последствия — конкретный, а не «вы уверены?». Человек должен
 * понимать, что именно сломается, до нажатия, а не после.
 */
const CONSEQUENCE: Partial<Record<FeatureFlag, { off: string; on: string }>> = {
  pii_access_log: {
    off: 'Журнал доступа к персональным данным перестанет вестись: кто из сотрудников открывал данные людей, останется неизвестным. Это нарушает требования по защите ПДн — выключайте только на время инцидента.',
    on: 'Журнал доступа к персональным данным снова будет вестись. Это правильное рабочее состояние.',
  },
  role_constructor: {
    off: 'Экран настройки ролей исчезнет. Уже выданные права сохранятся, но изменить их будет нельзя.',
    on: 'Экран настройки ролей станет доступен: сотрудники с правом на раздел смогут менять права других.',
  },
  commission_pdf: {
    off: 'Партнёры перестанут скачивать акты комиссии в PDF — деньги считаются те же, но документ не выгрузить.',
    on: 'Партнёры снова смогут скачивать акты комиссии в PDF.',
  },
  commission_xlsx: {
    off: 'Партнёры перестанут скачивать акты комиссии в XLSX — деньги считаются те же, но документ не выгрузить.',
    on: 'Партнёры снова смогут скачивать акты комиссии в XLSX.',
  },
};

const SOURCE_RU: Record<FlagSource, string> = {
  ui: 'задано здесь',
  env: 'настройка сервера',
  default: 'по умолчанию',
};

/** Инфраструктурные переменные — управляются только в env сервера; значения не показываем. */
const INFRA_ENV_VARS: { name: string; label: string }[] = [
  { name: 'DATABASE_URL', label: 'подключение к базе данных' },
  { name: 'JWT_SECRET', label: 'подпись сессий (вход в кабинет)' },
  { name: 'S3_*', label: 'объектное хранилище документов' },
  { name: 'REDIS_URL', label: 'очереди фоновых задач' },
];

const ERRORS_RU: Record<string, string> = {
  forbidden: 'Недостаточно прав',
  unknown_flag: 'Такой функции больше нет — обновите страницу',
  not_editable: 'Эта функция включается на сервере: она проверяется до обращения к базе',
};

type Pending = { row: FeatureFlagRow; next: boolean };

export function FeatureFlagsMatrix({ rows }: { rows: FeatureFlagRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply(flag: FeatureFlag, next: boolean | null) {
    setBusy(flag);
    setError(null);
    try {
      const res = await setFeatureFlagAction(flag, next);
      if (res.ok) {
        setPending(null);
        toast.success(
          next === null
            ? 'Значение снова берётся с сервера'
            : `Функция ${res.enabled ? 'включена' : 'выключена'} — применится в течение минуты`
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

  function request(row: FeatureFlagRow, next: boolean) {
    // `У-68`: опасное переключение — через подтверждение с последствием.
    if (row.sensitive) setPending({ row, next });
    else void apply(row.flag, next);
  }

  const consequence = pending
    ? CONSEQUENCE[pending.row.flag]?.[pending.next ? 'on' : 'off']
    : undefined;

  return (
    <section className="space-y-4 bg-white border border-gray-200 rounded-xl p-5">
      <div>
        <h2 className="font-semibold text-[#111111]">Функции платформы</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Включайте и выключайте функции прямо здесь — заходить на сервер не нужно. Изменение
          применяется в течение минуты. Функции, закрывающие целый раздел кабинета, по-прежнему
          переключаются в настройках сервера: они проверяются раньше, чем система успевает заглянуть
          в базу.
        </p>
      </div>

      {error && !pending && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
              <th className="py-2 pr-3 font-medium">Функция</th>
              <th className="py-2 pr-3 font-medium">Состояние</th>
              <th className="py-2 pr-3 font-medium">Откуда значение</th>
              <th className="py-2 font-medium">Действие</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.flag} data-testid={`flag-row-${row.flag}`}>
                <td className="py-2 pr-3 text-[#111111]">{FLAG_LABELS[row.flag]}</td>
                <td className="py-2 pr-3">
                  {row.enabled ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                      включён
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                      выключен
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs text-gray-500">
                  <span data-testid={`flag-source-${row.flag}`}>{SOURCE_RU[row.source]}</span>
                  {row.source !== 'ui' && (
                    <span className="text-gray-400 font-mono"> · {row.envVar}</span>
                  )}
                </td>
                <td className="py-2">
                  {row.editable ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant={row.enabled ? 'secondary' : 'primary'}
                        disabled={busy === row.flag}
                        onClick={() => request(row, !row.enabled)}
                        data-testid={`flag-toggle-${row.flag}`}
                      >
                        {row.enabled ? 'Выключить' : 'Включить'}
                      </Button>
                      {row.source === 'ui' && (
                        <button
                          type="button"
                          className="text-xs text-[#EA580C] hover:underline"
                          disabled={busy === row.flag}
                          onClick={() => void apply(row.flag, null)}
                          data-testid={`flag-reset-${row.flag}`}
                        >
                          вернуть настройку сервера
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-500" data-testid={`flag-locked-${row.flag}`}>
                      закрывает раздел — только на сервере
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
        <div className="font-medium text-gray-700 mb-1">
          Инфраструктура — управляется в настройках сервера (значения здесь не показываются):
        </div>
        <ul className="space-y-0.5">
          {INFRA_ENV_VARS.map((v) => (
            <li key={v.name}>
              <span className="font-mono">{v.name}</span> — {v.label}
            </li>
          ))}
        </ul>
      </div>

      <Dialog
        open={pending !== null}
        onClose={() => {
          setPending(null);
          setError(null);
        }}
        title={pending?.next ? 'Включить функцию?' : 'Выключить функцию?'}
        busy={busy !== null}
        error={error}
      >
        <div className="space-y-3 text-sm text-gray-700">
          <p data-testid="flag-consequence">{consequence}</p>
          <div className="flex gap-2 justify-end">
            <Button
              variant="primary"
              onClick={() => {
                setPending(null);
                setError(null);
              }}
              disabled={busy !== null}
            >
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                /* v8 ignore next -- диалог существует только при выбранном флаге */
                if (pending) void apply(pending.row.flag, pending.next);
              }}
              disabled={busy !== null}
              data-testid="flag-confirm"
            >
              {pending?.next ? 'Включить' : 'Выключить'}
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
