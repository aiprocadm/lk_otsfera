import React from 'react';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * Вкладка «Экспорт» (`У-244`, этап 7).
 *
 * Список отчётов реестра, доступных этой роли, — по одной ссылке на каждый.
 * Ссылка, а не кнопка со скриптом: файл скачивается обычным переходом, работает
 * без JavaScript и сохраняется в закладках вместе с периодом.
 *
 * Состав списка приходит со страницы: решать, что человеку доступно, — дело
 * сервера, а не разметки (§4).
 */
export type ExportableReport = { key: string; title: string; hint: string };

export function ReportsExportPanel({
  reports,
  query,
}: {
  reports: ExportableReport[];
  /** Период и компания — уходят в адрес выгрузки как есть. */
  query: Record<string, string>;
}) {
  if (reports.length === 0) {
    return (
      <div data-testid="reports-export">
        <EmptyState
          icon="📄"
          title="Отчётов для выгрузки нет"
          message="Эта роль не выгружает отчёты. Обратитесь к руководителю или администратору."
          className="p-6"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="reports-export">
      <p className="text-sm text-gray-700">
        Каждый отчёт скачивается в Excel за выбранный месяц. Если строк окажется слишком много,
        система скажет об этом и попросит сузить период — обрезанный отчёт не отдаём.
      </p>
      <ul className="space-y-2">
        {reports.map((r) => {
          const params = new URLSearchParams(query);
          return (
            <li
              key={r.key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-3"
            >
              <span>
                <span className="text-sm font-medium text-[#111111]">{r.title}</span>
                <span className="block text-xs text-gray-500">{r.hint}</span>
              </span>
              <a
                href={`/api/reports/${r.key}/export?${params.toString()}`}
                data-testid={`report-download-${r.key}`}
                className="rounded-lg bg-[#F97316] px-3 py-1.5 text-sm text-white hover:bg-[#EA580C]"
              >
                Скачать XLSX
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Какой отчёт скачивается с обычной вкладки (`У-244`).
 *
 * Человек смотрит на дебиторку и хочет её же в файле — заставлять его уходить
 * на «Экспорт» и искать отчёт по названию значит терять ответ на вопрос «что
 * делать дальше» (§15). Самой вкладки «Экспорт» здесь нет: на ней список
 * целиком. Отчёт «Загрузка менеджеров» своей вкладки не имеет и живёт только
 * в списке — это сознательно, отдельного экрана под него нет.
 */
export const TAB_REPORT: Record<string, string> = {
  plan: 'plan_fact',
  funnel: 'funnel_by_source',
  communications: 'communications',
  receivables: 'receivables',
  partners: 'partner_accruals',
};

/** Кнопка «Скачать XLSX» над содержимым вкладки — та же выгрузка, что в списке. */
export function TabExportLink({
  reportKey,
  query,
}: {
  reportKey: string;
  query: Record<string, string>;
}) {
  const params = new URLSearchParams(query);
  return (
    <div className="flex justify-end">
      <a
        href={`/api/reports/${reportKey}/export?${params.toString()}`}
        data-testid={`tab-download-${reportKey}`}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-[#111111] hover:bg-gray-50"
      >
        Скачать XLSX
      </a>
    </div>
  );
}
