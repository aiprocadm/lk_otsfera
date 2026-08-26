import React from 'react';
import { DEFAULT_SYNC_TZ } from '@/lib/jobs/scheduling';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { SlaSettingsCard } from '@/components/manager/sla-settings-card';
import { SyncScheduleEditor } from '@/components/admin/sync-schedule-editor';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import type { CompanySla } from '@/lib/services/manager/slaSettings';

/**
 * «Конфигурация процессов → SLA входящих в работу» (`У-130`).
 *
 * **Что было.** Пороги SLA жили карточкой на вкладке «Команда» руководителя —
 * то есть настройка процесса лежала в разделе про людей, а администратор не
 * видел её вовсе.
 *
 * **Что стало.** Раздел в хабе настроек. Руководитель правит свою компанию,
 * администратор видит **все** компании: пороги задаёт каждая компания сама, а
 * администратору нужно видеть картину целиком.
 *
 * Компонент **презентационный**: данные приходят пропсами, в базу он не ходит
 * (правило `components-no-db`). Выборку делает страница своей роли, скоуп —
 * сервис `listCompaniesSla` (админ — все компании, руководитель — своя).
 *
 * Название по глоссарию: эскалирует очередь «Входящие в работу», а не
 * «Обращения» — это разные объекты.
 */
const SLA_SCHEDULER_ID = 'monitoring.slaEscalation.cron';

export function SlaIntakeScreen({
  cabinet,
  hasCompany,
  companies,
  patterns,
}: {
  cabinet: SettingsCabinet;
  /** У руководителя без компании настраивать нечего — экран объясняет это. */
  hasCompany: boolean;
  companies: CompanySla[];
  /** Расписания задач (`У-125`); нужны только администратору. */
  patterns: ReadonlyMap<string, string>;
}) {
  const isAdmin = cabinet === 'admin';

  return (
    <div className="space-y-5">
      <PageHeader
        title="SLA входящих в работу"
        subtitle={
          isAdmin
            ? 'Через сколько часов подсветить обращение и через сколько эскалировать руководителю. Пороги задаёт каждая компания.'
            : 'Через сколько часов подсветить обращение и через сколько эскалировать вам.'
        }
      />

      {!isAdmin && !hasCompany ? (
        <p role="alert" className="text-sm text-red-600">
          У вашей учётной записи не указана компания — пороги настроить нельзя. Обратитесь к
          администратору.
        </p>
      ) : companies.length === 0 ? (
        // `У-74`: пустой экран обязан сказать, почему он пуст и что нажать.
        <EmptyState
          icon="⏱️"
          title="Компаний пока нет"
          message="Пороги SLA задаёт каждая компания. Заведите компанию — и её пороги появятся здесь."
          action={
            <a
              href="/admin/settings/access/roles"
              className="text-sm font-medium text-[#F97316] hover:underline"
            >
              Перейти к настройкам доступа
            </a>
          }
        />
      ) : isAdmin ? (
        <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Компания</th>
                <th className="px-4 py-3 text-right font-medium">Подсветить через, часов</th>
                <th className="px-4 py-3 text-right font-medium">Эскалировать через, часов</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-[#111111]">{c.name}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{c.slaWarningHours}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{c.slaResponseHours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <SlaSettingsCard
          initial={{
            slaResponseHours: companies[0]!.slaResponseHours,
            slaWarningHours: companies[0]!.slaWarningHours,
          }}
        />
      )}

      {isAdmin && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-2">
          <h2 className="text-sm font-semibold text-[#111111]">Как часто проверять</h2>
          <p className="text-xs text-gray-500">
            Задача проверяет очередь и эскалирует просроченные обращения. Пороги задают компании, а
            расписание — общее для платформы.
          </p>
          <SyncScheduleEditor
            schedulerId={SLA_SCHEDULER_ID}
            tz={DEFAULT_SYNC_TZ}
            current={patterns.get(SLA_SCHEDULER_ID) ?? '—'}
            isDefault={!patterns.has(SLA_SCHEDULER_ID)}
          />
        </div>
      )}

      {isAdmin && (
        <p className="text-xs text-gray-400">
          Администратор видит пороги всех компаний; менять их может руководитель своей компании —
          это его рабочее решение, а не платформенное.
        </p>
      )}
    </div>
  );
}
