'use client';

import React, { useRef, useState } from 'react';
import { previewImportAction, commitImportAction } from '@/server-actions/import';
import type { BatchSummary } from '@/lib/services/oneCSync/record-batch';
import type { ImportDiagnostics } from '@/lib/services/import/diagnostics';
import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_FILE_MB } from '@/lib/config/import-limits';
import { clientLog } from '@/lib/logging/client';
import { CompanyPicker } from './company-picker';
import { XLSX_IMPORT_ERRORS, errorMessage as messageFor, fileSizeMb } from './error-messages';

type ImportReport = {
  orgs: BatchSummary;
  orders: BatchSummary;
  payments: BatchSummary;
  diagnostics: ImportDiagnostics;
};

/** `detail` — уточнение к тексту ошибки (например фактический размер файла). */
type Failure = {
  ok: false;
  error: string;
  detail?: string;
  diagnostics?: ImportDiagnostics;
};

type PreviewResult = { ok: true; report: ImportReport } | Failure;

type CommitResult = { ok: true; report: ImportReport } | Failure;

function errorMessage(code: string): string {
  return messageFor(XLSX_IMPORT_ERRORS, code);
}

/** Отказ до отправки: слишком большой файл не имеет смысла везти на сервер (Т-6). */
function tooLargeFailure(file: File): Failure {
  return { ok: false, error: 'file_too_large', detail: `Ваш файл — ${fileSizeMb(file.size)} МБ.` };
}

/**
 * «Что увидела система в файле» (ТЗ починки импорта 1С, Т-3).
 *
 * Блок серый, а не красный: сам по себе он не ошибка — его показывают и при
 * успешном разборе. Нужен он прежде всего в обратном случае: раньше при нуле
 * распознанных строк пользователь видел «Файл пуст» и не мог понять, что
 * система вообще нашла в книге.
 */
function DiagnosticsPanel({ diagnostics }: { diagnostics: ImportDiagnostics }) {
  const unmatched = Object.entries(diagnostics.unmatchedHeaders).filter(
    ([, headers]) => headers.length > 0
  );
  // `?? {}` — страховка от ответа старой версии сервера без новых полей.
  const missing = Object.entries(diagnostics.missingColumns ?? {});
  const duplicates = Object.entries(diagnostics.duplicateSheets ?? {});
  return (
    <div
      className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm"
      data-testid="import-diagnostics"
    >
      <h3 className="text-sm font-semibold text-[#111111] mb-2">Что увидела система в файле</h3>
      <dl className="space-y-1">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-gray-600">Листы в файле:</dt>
          <dd className="text-[#111111]" data-testid="diagnostics-sheets-found">
            {diagnostics.sheetsFound.length > 0 ? diagnostics.sheetsFound.join(' · ') : '—'}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-gray-600">Ожидаемые листы:</dt>
          <dd className="text-[#111111]">{diagnostics.sheetsExpected.join(' · ')}</dd>
        </div>
      </dl>
      {unmatched.length > 0 && (
        <div className="mt-2">
          <div className="text-gray-600">Не распознаны заголовки:</div>
          <ul className="mt-1 space-y-0.5">
            {unmatched.map(([sheet, headers]) => (
              <li key={sheet} className="text-[#111111]">
                {sheet} — {headers.map((h) => `«${h}»`).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {missing.length > 0 && (
        <div className="mt-2" data-testid="diagnostics-missing-columns">
          <div className="text-gray-600">Не найдены обязательные колонки:</div>
          <ul className="mt-1 space-y-0.5">
            {missing.map(([sheet, labels]) => (
              <li key={sheet} className="text-[#111111]">
                {sheet} — {labels.map((l) => `«${l}»`).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {duplicates.length > 0 && (
        <div className="mt-2" data-testid="diagnostics-duplicate-sheets">
          <div className="text-gray-600">Несколько листов подходят под один вид (взят первый):</div>
          <ul className="mt-1 space-y-0.5">
            {duplicates.map(([kind, names]) => (
              <li key={kind} className="text-[#111111]">
                {kind} — ещё {names.map((n) => `«${n}»`).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {diagnostics.formatNote && (
        <p className="mt-2 text-gray-600" data-testid="diagnostics-format-note">
          {diagnostics.formatNote}
        </p>
      )}
    </div>
  );
}

function ReasonsTable({ entity, summary }: { entity: string; summary: BatchSummary }) {
  const rows: Array<{ externalId: string | null; reason: string }> = [
    ...summary.skips.map((s) => ({ externalId: s.externalId, reason: s.reason })),
    ...summary.invalids.map((inv) => ({ externalId: inv.externalId, reason: inv.issue })),
  ];
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-sm font-medium text-gray-700 mb-1">
        {entity} — причины пропуска / ошибок
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                externalId
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Причина
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-3 py-1.5 text-gray-700">{r.externalId ?? '—'}</td>
                <td className="px-3 py-1.5 text-gray-700">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EntitySummary({
  label,
  summary,
  entityKey,
}: {
  label: string;
  summary: BatchSummary;
  entityKey: 'orgs' | 'orders' | 'payments';
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-[#111111] mb-2">{label}</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div className="text-gray-600">Прочитано</div>
        <div className="font-medium text-[#111111]">{summary.pulled}</div>

        <div className="text-gray-600">Создано</div>
        <div className="font-medium text-[#111111]" data-testid={`count-${entityKey}-created`}>
          {summary.created}
        </div>

        <div className="text-gray-600">Обновлено</div>
        <div className="font-medium text-[#111111]" data-testid={`count-${entityKey}-updated`}>
          {summary.updated}
        </div>

        <div className="text-gray-600">Пропущено</div>
        <div className="font-medium text-[#111111]" data-testid={`count-${entityKey}-skipped`}>
          {summary.skipped}
        </div>

        <div className="text-gray-600">Невалидных</div>
        <div className="font-medium text-[#111111]">{summary.invalid}</div>

        {summary.failed > 0 && (
          <>
            <div className="text-gray-600">Ошибок</div>
            <div className="font-medium text-red-600">{summary.failed}</div>
          </>
        )}
      </div>
      <ReasonsTable entity={label} summary={summary} />
    </div>
  );
}

/**
 * `companies` передаёт только админская страница (Т-41): admin — Model A, своей
 * компании не имеет, поэтому выбирает, куда привязывать НОВЫЕ организации.
 * Руководителю/менеджеру компанию задаёт скоуп сессии — их страницы проп не
 * передают, и блок не рендерится вовсе.
 */
export function ImportForm({ companies }: { companies?: Array<{ id: string; name: string }> }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasFile, setHasFile] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  // Единственная компания в системе — она же по умолчанию, без вопроса (Т-41).
  const single = companies?.length === 1 ? companies[0] : undefined;
  const [companyId, setCompanyId] = useState(single?.id ?? '');

  function handleFileChange() {
    setHasFile(!!fileInputRef.current?.files?.length);
    // Reset previous results when user picks a new file
    setPreview(null);
    setCommitResult(null);
  }

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setPreview(null);
    setCommitResult(null);
    // Т-6: предпроверка размера — запрос не уходит вовсе, иначе Next обрежет
    // тело и форма замолчит.
    if (file.size > IMPORT_MAX_FILE_BYTES) {
      setPreview(tooLargeFailure(file));
      return;
    }
    setIsPreviewing(true);
    try {
      const form = new FormData();
      form.set('file', file);
      if (companyId) form.set('companyId', companyId);
      const result = await previewImportAction(form);
      setPreview(result as PreviewResult);
    } catch (e) {
      // Т-4: без этой ветки отклонённый промис не менял состояние — кнопка
      // отщёлкивала, и на экране не появлялось ничего.
      clientLog.error('[1c-import] запрос предпросмотра не дошёл до сервера', e);
      setPreview({ ok: false, error: 'network_or_server' });
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleCommit() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    if (file.size > IMPORT_MAX_FILE_BYTES) {
      setCommitResult(tooLargeFailure(file));
      return;
    }
    setIsCommitting(true);
    try {
      const form = new FormData();
      form.set('file', file);
      if (companyId) form.set('companyId', companyId);
      const result = await commitImportAction(form);
      setCommitResult(result as CommitResult);
    } catch (e) {
      clientLog.error('[1c-import] запрос импорта не дошёл до сервера', e);
      setCommitResult({ ok: false, error: 'network_or_server' });
    } finally {
      setIsCommitting(false);
    }
  }

  const report = preview?.ok ? preview.report : null;
  // Диагностика приходит и в успешном отчёте, и в ветке ошибки. `?? null` —
  // страховка от ответа старой версии сервера без этого поля.
  const diagnostics = (preview?.ok ? preview.report.diagnostics : preview?.diagnostics) ?? null;

  return (
    <div className="space-y-6">
      <form onSubmit={handlePreview} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {`Файл Excel (.xls или .xlsx, до ${IMPORT_MAX_FILE_MB} МБ)`}
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xls,.xlsx"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-700 border border-gray-300 rounded px-3 py-2
              file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium
              file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] cursor-pointer"
            data-testid="import-file-input"
          />
        </div>

        {/* Т-41/`У-50`: несколько компаний — выбор обязателен; смена выбора
            сбрасывает уже посчитанный план (он считался для другой компании). */}
        <CompanyPicker
          companies={companies}
          value={companyId}
          onChange={(id) => {
            setCompanyId(id);
            setPreview(null);
            setCommitResult(null);
          }}
          idPrefix="import"
        />

        <button
          type="submit"
          disabled={!hasFile || isPreviewing}
          className="px-4 py-2 rounded text-sm font-medium text-white transition-colors
            bg-[#F97316] hover:bg-[#EA580C] disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="import-preview-button"
        >
          {isPreviewing ? 'Загрузка…' : 'Загрузить и проверить'}
        </button>
      </form>

      {/* Error from preview */}
      {preview && !preview.ok && (
        <div
          role="alert"
          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2"
        >
          {errorMessage(preview.error)}
          {preview.detail ? ` ${preview.detail}` : ''}
        </div>
      )}

      {/* Что увидела система в файле — и при успехе, и при ошибке (Т-3) */}
      {diagnostics && <DiagnosticsPanel diagnostics={diagnostics} />}

      {/* Preview report */}
      {report && (
        <div className="space-y-4" data-testid="import-plan">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-base font-semibold text-[#111111] mb-3">Результаты проверки</h2>
            <p className="text-xs text-gray-500">Режим: предпросмотр (данные не записаны)</p>
          </div>

          {/* Т-18: организации — наравне с заказами и оплатами, и первыми (порядок импорта). */}
          <EntitySummary label="Организации" summary={report.orgs} entityKey="orgs" />
          <EntitySummary label="Заказы" summary={report.orders} entityKey="orders" />
          <EntitySummary label="Оплаты" summary={report.payments} entityKey="payments" />

          {/* Commit button */}
          {commitResult === null && (
            <button
              type="button"
              onClick={handleCommit}
              disabled={isCommitting}
              className="px-4 py-2 rounded text-sm font-medium text-white transition-colors
                bg-[#F97316] hover:bg-[#EA580C] disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="import-commit-button"
            >
              {isCommitting ? 'Импорт…' : 'Подтвердить импорт'}
            </button>
          )}
        </div>
      )}

      {/* Commit result */}
      {commitResult && commitResult.ok && (
        <div role="status" className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-green-800">Импорт выполнен</p>
          </div>
          <EntitySummary
            label="Организации (итог)"
            summary={commitResult.report.orgs}
            entityKey="orgs"
          />
          <EntitySummary
            label="Заказы (итог)"
            summary={commitResult.report.orders}
            entityKey="orders"
          />
          <EntitySummary
            label="Оплаты (итог)"
            summary={commitResult.report.payments}
            entityKey="payments"
          />
        </div>
      )}

      {commitResult && !commitResult.ok && (
        <div
          role="alert"
          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2"
        >
          {errorMessage(commitResult.error)}
          {commitResult.detail ? ` ${commitResult.detail}` : ''}
        </div>
      )}
    </div>
  );
}
