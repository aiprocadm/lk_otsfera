import React from 'react';
import {
  FEATURE_FLAGS,
  isFeatureEnabled,
  isOptInFlag,
  featureFlagEnvVar,
  type FeatureFlag
} from '@/lib/featureFlags';

/**
 * Read-only матрица feature-флагов на /admin/settings (этап 1 ТЗ, ФТ-14.6,
 * спека §7). Только отображение: флаги читаются из env в трёх точках
 * (middleware/nav/route), поэтому переключение из UI невозможно — меняются
 * в конфиге сервера. Источник истины по описаниям — docs/feature-flags-matrix.md.
 *
 * Record<FeatureFlag, string> — намеренно exhaustive: новый флаг без описания
 * ломает typecheck и не может молча выпасть из матрицы.
 */

const FLAG_LABELS: Record<FeatureFlag, string> = {
  partner_leads: 'Заявки-лиды партнёра (с вложениями)',
  client_requests: 'Обращения клиентов (этап 5): подача и триаж',
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
  intake_inbox: 'Входящие в работу (этап 7): единый триаж-экран',
  document_generation: 'Генерация счёта/акта по заказу (этап 8)'
};

/** Инфраструктурные переменные — управляются только в env сервера; значения не показываем. */
const INFRA_ENV_VARS: { name: string; label: string }[] = [
  { name: 'DATABASE_URL', label: 'подключение к базе данных' },
  { name: 'JWT_SECRET', label: 'подпись сессий (вход в кабинет)' },
  { name: 'S3_*', label: 'объектное хранилище документов' },
  { name: 'REDIS_URL', label: 'очереди фоновых задач' }
];

export function FeatureFlagsMatrix() {
  return (
    <section className="space-y-4 bg-white border border-gray-200 rounded-xl p-5">
      <div>
        <h2 className="font-semibold text-[#111111]">Функции платформы (feature-флаги)</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Только просмотр: флаги переключаются в конфиге сервера (env) и применяются
          при перезапуске. Интеграции настраиваются на странице «Интеграции».
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
              <th className="py-2 pr-3 font-medium">Функция</th>
              <th className="py-2 pr-3 font-medium">Состояние</th>
              <th className="py-2 pr-3 font-medium">Тип</th>
              <th className="py-2 font-medium">Env-переменная</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {FEATURE_FLAGS.map((flag) => {
              const enabled = isFeatureEnabled(flag);
              return (
                <tr key={flag}>
                  <td className="py-2 pr-3 text-[#111111]">{FLAG_LABELS[flag]}</td>
                  <td className="py-2 pr-3">
                    {enabled ? (
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
                    {isOptInFlag(flag) ? 'включается явно' : 'включён по умолчанию'}
                  </td>
                  <td className="py-2 text-xs text-gray-400 font-mono">{featureFlagEnvVar(flag)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
        <div className="font-medium text-gray-700 mb-1">
          Инфраструктура — управляется в env сервера (значения здесь не показываются):
        </div>
        <ul className="space-y-0.5">
          {INFRA_ENV_VARS.map((v) => (
            <li key={v.name}>
              <span className="font-mono">{v.name}</span> — {v.label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
