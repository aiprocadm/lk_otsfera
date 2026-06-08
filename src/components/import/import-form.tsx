'use client';

import React, { useRef, useState } from 'react';
import { previewImportAction, commitImportAction } from '@/server-actions/import';
import type { ImportPlan, Quarantine } from '@/lib/services/import/types';

type PreviewResult =
  | { ok: true; plan: ImportPlan }
  | { ok: false; error: 'invalid_file' | 'forbidden' | 'empty' | 'parse_failed' };

type AppliedCounts = Record<string, number>;
type CommitResult =
  | { ok: true; applied: AppliedCounts; skipped: unknown }
  | { ok: false; error: string };

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: 'Недостаточно прав',
  invalid_file: 'Выберите .xlsx файл',
  empty: 'Файл пуст или нет валидных строк',
  parse_failed: 'Не удалось разобрать файл',
};

function errorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? `Ошибка: ${code}`;
}

function QuarantineTable({ rows, title }: { rows: Quarantine[]; title: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-sm font-medium text-gray-700 mb-1">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Лист</th>
              <th className="text-left px-3 py-2 font-medium">Строка</th>
              <th className="text-left px-3 py-2 font-medium">Причина</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-3 py-1.5 text-gray-700">{q.sheet}</td>
                <td className="px-3 py-1.5 text-gray-700">{q.rowIndex + 1}</td>
                <td className="px-3 py-1.5 text-gray-700">{q.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
      // commitImportAction returns applied as ImportCounts (compatible with Record<string,number>)
      setCommitResult(result as unknown as CommitResult);
    } finally {
      setIsCommitting(false);
    }
  }

  const plan = preview?.ok ? preview.plan : null;
  const allSkipped = plan
    ? [...plan.skipped.orgs, ...plan.skipped.orders, ...plan.skipped.payments]
    : [];

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

      {/* Preview plan */}
      {plan && (
        <div className="space-y-4" data-testid="import-plan">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-base font-semibold text-[#111111] mb-3">Результаты проверки</h2>

            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <div className="text-gray-600">Организации: создано</div>
              <div className="font-medium text-[#111111]" data-testid="count-orgs-created">{plan.counts.orgsCreated}</div>

              <div className="text-gray-600">Организации: обновлено</div>
              <div className="font-medium text-[#111111]" data-testid="count-orgs-updated">{plan.counts.orgsUpdated}</div>

              <div className="text-gray-600">Организации: самостоятельных</div>
              <div className="font-medium text-[#111111]" data-testid="count-orgs-standalone">{plan.counts.orgsStandalone}</div>

              <div className="text-gray-600">Заказы: обработано</div>
              <div className="font-medium text-[#111111]" data-testid="count-orders">{plan.counts.ordersUpserted}</div>

              <div className="text-gray-600">Оплаты: обработано</div>
              <div className="font-medium text-[#111111]" data-testid="count-payments">{plan.counts.paymentsUpserted}</div>
            </div>
          </div>

          {/* Skipped rows (always shown, even if zero) */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-base font-semibold text-[#111111] mb-1">
              Пропущено ({allSkipped.length})
            </h2>
            {allSkipped.length === 0 ? (
              <p className="text-sm text-gray-500">Пропущенных строк нет.</p>
            ) : (
              <>
                <QuarantineTable rows={plan.skipped.orgs} title="Организации" />
                <QuarantineTable rows={plan.skipped.orders} title="Заказы" />
                <QuarantineTable rows={plan.skipped.payments} title="Оплаты" />
              </>
            )}
          </div>

          {/* Quarantine (always shown, even if zero) */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-base font-semibold text-[#111111] mb-1">
              Карантин (невалидные строки) ({plan.quarantine.length})
            </h2>
            {plan.quarantine.length === 0 ? (
              <p className="text-sm text-gray-500">Невалидных строк нет.</p>
            ) : (
              <QuarantineTable rows={plan.quarantine} title="" />
            )}
          </div>

          {/* Commit */}
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
        <div role="status" className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-green-800">Импорт выполнен</p>
          {commitResult.applied && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {Object.entries(commitResult.applied).map(([k, v]) => (
                <React.Fragment key={k}>
                  <div className="text-green-700">{k}</div>
                  <div className="font-medium text-green-900">{v}</div>
                </React.Fragment>
              ))}
            </div>
          )}
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
