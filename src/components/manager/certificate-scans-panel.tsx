'use client';
import React from 'react';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Select } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { suggestScanMatches } from '@/lib/orders/certificateScanMatch';
import type { CertificateScanTarget, ScanFileError } from '@/lib/services/manager/certificateScans';

/**
 * Этап 12 PR-2 (Модуль 5, ФТ-5.3) — массовая загрузка сканов удостоверений.
 *
 * Менеджер выбирает пачку файлов, панель предлагает слушателя по совпадению ФИО
 * в имени файла — но **подставляет только однозначные совпадения и помечает их
 * как подсказку**: ТЗ требует обязательного ручного подтверждения, поэтому
 * отправка заблокирована, пока не выбран слушатель для каждого файла.
 */

const FILE_ERROR_RU: Record<ScanFileError, string> = {
  item_not_found: 'слушатель не найден в заказе',
  certificate_missing: 'у слушателя ещё нет удостоверения',
  too_large: 'файл слишком большой',
  invalid_mime: 'недопустимый тип файла',
  storage: 'не удалось сохранить файл',
};

type Row = {
  file: File;
  itemId: string;
  suggested: boolean;
};

type RowResult = { fileName: string; ok: boolean; message: string };

export function CertificateScansPanel({
  orderId,
  targets,
}: {
  orderId: string;
  targets: CertificateScanTarget[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RowResult[] | null>(null);

  const withCertificate = targets.filter((t) => t.certificateId !== null);
  const missingScans = withCertificate.filter((t) => !t.hasScan).length;

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setResults(null);
    const files = Array.from(e.target.files ?? []);
    const matches = suggestScanMatches(
      files.map((f) => f.name),
      withCertificate.map((t) => ({ itemId: t.itemId, studentName: t.studentName }))
    );
    setRows(
      files.map((file, index) => {
        // suggestScanMatches — это map по тем же именам файлов, поэтому длина и
        // порядок matches совпадают с files: matches[index] всегда есть.
        const match = matches[index]!;
        return {
          file,
          itemId: match.suggestedItemId ?? '',
          suggested: match.suggestedItemId !== null,
        };
      })
    );
  }

  function setRowItem(index: number, itemId: string) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, itemId, suggested: false } : row))
    );
  }

  function reset() {
    setRows([]);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rows.some((r) => !r.itemId)) {
      setError('Для каждого файла выберите слушателя.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      for (const row of rows) {
        form.append('file', row.file);
        form.append('orderItemId', row.itemId);
      }
      const res = await fetch(`/api/manager/orders/${orderId}/certificate-scans`, {
        method: 'POST',
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError('Не удалось загрузить сканы. Обновите страницу и попробуйте ещё раз.');
        return;
      }
      const mapped: RowResult[] = (body.results as Array<Record<string, unknown>>).map((r) => ({
        fileName: String(r.fileName),
        ok: r.ok === true,
        message:
          r.ok === true
            ? 'загружен'
            : (FILE_ERROR_RU[r.error as ScanFileError] ?? 'не удалось загрузить'),
      }));
      setResults(mapped);
      const okCount = mapped.filter((r) => r.ok).length;
      if (okCount > 0) toast.success(`Загружено сканов: ${okCount}`);
      if (okCount < mapped.length) toast.error('Часть файлов не загрузилась — см. список.');
      reset();
      router.refresh();
    } catch {
      setError('Сеть недоступна. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
          Сканы удостоверений
        </h2>
        {missingScans > 0 ? (
          <Badge tone="warning">Без скана: {missingScans}</Badge>
        ) : (
          <Badge tone="success">Все сканы загружены</Badge>
        )}
      </div>

      {withCertificate.length === 0 ? (
        <p className="text-sm text-gray-500">
          Сканы можно загрузить после того, как слушателям выданы удостоверения.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            multiple
            aria-label="Файлы сканов"
            onChange={handleFiles}
            disabled={busy}
            className="block w-full text-sm text-gray-700"
          />

          {rows.length > 0 && (
            <>
              <p className="text-xs text-gray-500">
                Слушатель подставлен по совпадению ФИО в имени файла — это подсказка, проверьте
                каждую строку.
              </p>
              <ul className="space-y-2">
                {rows.map((row, index) => (
                  <li
                    key={`${row.file.name}-${index}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="text-sm text-gray-700 min-w-0 flex-1 truncate">
                      {row.file.name}
                    </span>
                    {row.suggested && <Badge tone="warning">подсказка</Badge>}
                    <Select
                      aria-label={`Слушатель для файла ${row.file.name}`}
                      value={row.itemId}
                      onChange={(e) => setRowItem(index, e.target.value)}
                      disabled={busy}
                      className="w-auto"
                    >
                      <option value="">— выберите слушателя —</option>
                      {withCertificate.map((t) => (
                        <option key={t.itemId} value={t.itemId}>
                          {t.studentName}
                          {t.certificateNumber ? ` · ${t.certificateNumber}` : ''}
                          {t.hasScan ? ' (скан заменится)' : ''}
                        </option>
                      ))}
                    </Select>
                  </li>
                ))}
              </ul>
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          {results && (
            <ul className="text-sm space-y-1" aria-label="Результат загрузки">
              {results.map((r) => (
                <li key={r.fileName} className={r.ok ? 'text-gray-700' : 'text-red-600'}>
                  {r.fileName} — {r.message}
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={busy || rows.length === 0}>
              {busy ? 'Загружаем…' : 'Загрузить сканы'}
            </Button>
            {rows.length > 0 && (
              <Button type="button" variant="secondary" onClick={reset} disabled={busy}>
                Очистить
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
