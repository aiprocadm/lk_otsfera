import React from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { BATCH_STATUS_LABELS } from '@/components/bitrix/batch-list';
import { fmtDateTime } from '@/lib/format';
import type { CrossCompanyResult } from '@/lib/services/admin/crossCompany';

/**
 * Свод по компаниям за месяц на «Главной» администратора (`У-246`, этап 7).
 *
 * Отвечает на кросс-компанийный вопрос «где что происходит»: до этого числа на
 * главной были по платформе целиком, и по ним нельзя было понять, у какой
 * компании встало.
 *
 * Названия колонок — те же слова, что в меню и отчётах (правило зеркала §0.2):
 * «Заказы», «Оплачено», «Лиды», «Обращения».
 */
const MODE_LABELS: Record<string, string> = {
  initial: 'первый перенос',
  resync: 'повторный',
};

function money(raw: string): string {
  return `${Number(raw).toLocaleString('ru-RU')} ₽`;
}

export function CrossCompanyPanel({ data }: { data: CrossCompanyResult }) {
  const monthLabel = `${String(data.month).padStart(2, '0')}.${data.year}`;

  return (
    <section className="space-y-3" data-testid="admin-cross-company">
      <h2 className="text-sm font-semibold text-[#111111]">По компаниям за {monthLabel}</h2>

      {data.rows.length === 0 ? (
        // Кнопки здесь нет намеренно: компанию заводят при настройке площадки,
        // экрана создания в кабинете не существует — ссылка в никуда хуже её
        // отсутствия. Случай практически недостижим: раз есть администратор,
        // есть и компания.
        <EmptyState
          icon="🏢"
          title="Компаний на платформе нет"
          message="Свод считается по компаниям, а их пока ни одной. Компании заводятся при настройке площадки — обратитесь к тому, кто её разворачивал."
          className="p-6"
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                <th className="px-4 py-2">Компания</th>
                <th className="px-4 py-2">Заказы</th>
                <th className="px-4 py-2">Оплачено</th>
                <th className="px-4 py-2">Лиды</th>
                <th className="px-4 py-2">Обращения</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr
                  key={row.companyId}
                  className="border-b border-gray-100"
                  data-testid={`cross-company-${row.companyId}`}
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/finance?company=${row.companyId}`}
                      className="text-[#111111] hover:text-[#F97316] hover:underline"
                    >
                      {row.companyName}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.orders}</td>
                  <td className="px-4 py-2">{money(row.paid)}</td>
                  <td className="px-4 py-2">{row.leads}</td>
                  <td className="px-4 py-2">{row.requests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
        {/* `У-174`: та же цифра, что у светофора интеграций — один расчёт. */}
        <Link
          href="/admin/documents?oneCPushStatus=failed"
          data-testid="admin-docs-not-pushed"
          className="rounded-xl border border-gray-200 bg-white p-4 text-sm hover:shadow-md"
        >
          <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Документы не выгружены в 1С
          </div>
          <div
            className={
              data.docsNotPushed > 0
                ? 'mt-1 text-2xl font-bold text-red-700'
                : 'mt-1 text-2xl font-bold text-[#111111]'
            }
          >
            {data.docsNotPushed}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {data.docsNotPushed === 0
              ? 'Всё уехало — разбирать нечего'
              : 'Нажмите, чтобы разобрать список'}
          </div>
        </Link>

        <div
          className="rounded-xl border border-gray-200 bg-white p-4 text-sm"
          data-testid="admin-last-migration"
        >
          <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Последний перенос из Битрикс24
          </div>
          {data.lastMigration === null ? (
            <div className="mt-1 text-sm text-gray-500">
              Переносов ещё не было.{' '}
              <Link
                href="/admin/settings/integrations/bitrix"
                className="text-[#F97316] hover:underline"
              >
                Открыть раздел переноса
              </Link>
            </div>
          ) : (
            <div className="mt-1 space-y-1">
              <div className="text-base font-semibold text-[#111111]">
                {data.lastMigration.companyName}
              </div>
              <div className="text-xs text-gray-600">
                {BATCH_STATUS_LABELS[data.lastMigration.status] ?? data.lastMigration.status} ·{' '}
                {MODE_LABELS[data.lastMigration.mode] ?? data.lastMigration.mode} ·{' '}
                {fmtDateTime(data.lastMigration.createdAt)}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
