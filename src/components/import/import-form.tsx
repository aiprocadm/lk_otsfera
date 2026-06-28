'use client';

import React, { useRef, useState } from 'react';
import { previewImportAction, commitImportAction } from '@/server-actions/import';
import type { BatchSummary } from '@/lib/services/oneCSync/record-batch';

type ImportReport = { orders: BatchSummary; payments: BatchSummary };

type PreviewResult =
  | { ok: true; report: ImportReport }
  | { ok: false; error: string };

type CommitResult =
  | { ok: true; report: ImportReport }
  | { ok: false; error: string };

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: 'Недостаточно прав',
  invalid_file: 'Выберите .xlsx файл (не более 20 МБ)',
  empty: 'Файл пуст или нет валидных строк',
  parse_failed: 'Не удалось разобрать файл',
};

function errorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? `Ошибка: ${code}`;
}

function ReasonsTable({ entity, summary }: { entity: string; summary: BatchSummary }) {
  const rows: Array<{ externalId: string | null; reason: string }> = [
    ...summary.skips.map((s) => ({ externalId: s.externalId, reason: s.reason })),
    ...summary.invalids.map((inv) => ({ externalId: inv.externalId, reason: inv.issue })),
  ];
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-sm font-medium text-gray-700 mb-1">{entity} — причины пропуска / ошибок</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th scope="col" className="text-left px-3 py-2 font-medium">externalId</th>
              <th scope="col" className="text-left px-3 py-2 font-medium">Причина</th>
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
  entityKey: 'orders' | 'payments';
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-[#111111] mb-2">{label}</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div className="text-gray-600">Прочитано</div>
        <div className="font-medium text-[#111111]">{summary.pulled}</div>

        <div className="text-gray-600">Создано</div>
        <div className="font-medium text-[#111111]" data-testid={`count-${entityKey}-created`}>{summary.created}</div>

        <div className="text-gray-600">Обновлено</div>
        <div className="font-medium text-[#111111]" data-testid={`count-${entityKey}-updated`}>{summary.updated}</div>

        <div className="text-gray-600">Пропущено</div>
        <div className="font-medium text-[#111111]" data-testid={`count-${entityKey}-skipped`}>{summary.skipped}</div>

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

export function ImportForm() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasFile, setHasFile] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  function handleFileChange() {
    setHasFile(!!(fileInputRef.current?.files?.length));
    // Reset previous results when user picks a new file
    setPreview(null);
    setCommitResult(null);
  }

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setIsPreviewing(true);
    setPreview(null);
    setCommitResult(null);
    try {
      const form = new FormData();
      form.set('file', file);
      const result = await previewImportAction(form);
      setPreview(result as PreviewResult);
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleCommit() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setIsCommitting(true);
    try {
      const form = new FormData();
      form.set('file', file);
      const result = await commitImportAction(form);
      setCommitResult(result as CommitResult);
    } finally {
      setIsCommitting(false);
    }
  }

  const report = preview?.ok ? preview.report : null;

  return (
    <div className="space-y-6">
      <form onSubmit={handlePreview} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Файл Excel (.xlsx)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-700 border border-gray-300 rounded px-3 py-2
              file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium
              file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] cursor-pointer"
            data-testid="import-file-input"
          />
        </div>

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
        <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2">
          {errorMessage(preview.error)}
        </div>
      )}

      {/* Preview report */}
      {report && (
        <div className="space-y-4" data-testid="import-plan">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-base font-semibold text-[#111111] mb-3">Результаты проверки</h2>
            <p className="text-xs text-gray-500">Режим: предпросмотр (данные не записаны)</p>
          </div>

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
          <EntitySummary label="Заказы (итог)" summary={commitResult.report.orders} entityKey="orders" />
          <EntitySummary label="Оплаты (итог)" summary={commitResult.report.payments} entityKey="payments" />
        </div>
      )}

      {commitResult && !commitResult.ok && (
        <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2">
          {errorMessage((commitResult as { ok: false; error: string }).error)}
        </div>
      )}
    </div>
  );
}
