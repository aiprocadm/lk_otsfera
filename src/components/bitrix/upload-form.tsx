'use client';
import React, { useState } from 'react';
import { BITRIX_UPLOAD_MAX_FILES, IMPORT_MAX_FILE_MB } from '@/lib/config/import-limits';
import { BITRIX_ENTITY_LABELS, type BitrixFileDiagnostic } from '@/lib/services/bitrix/column-map';
import { useFetchSubmit } from '@/lib/ui/useFetchSubmit';
import { Button } from '@/components/ui/button';
import { TableShell, THead, Th, Tr, Td } from '@/components/ui/table';

/**
 * Форма файлов выгрузки Битрикс24 (`У-189` file, вкладка «Пакеты»). Файловый
 * роут через `useFetchSubmit` (§11 CLAUDE.md: не server action — лимит тела).
 * Ответ роута — диагностика по каждому файлу: что за сущность, сколько строк,
 * какие колонки не распознаны. Ключи распознанных файлов подхватит форма
 * «Новый пакет» (PR-3); до неё экран честно показывает результат проверки.
 */
type UploadedFile = BitrixFileDiagnostic & { key: string | null };
type UploadResponse = { files?: UploadedFile[] };

const ERROR_LABELS: Record<string, string> = {
  no_files: 'Выберите хотя бы один файл выгрузки.',
  too_many_files: `За один раз можно загрузить не больше ${BITRIX_UPLOAD_MAX_FILES} файлов.`,
  too_large: `Файл больше ${IMPORT_MAX_FILE_MB} МБ — разбейте выгрузку по периодам.`,
  invalid_mime: 'Подходят только файлы .csv и .xlsx.',
  file_unreadable:
    'Файл не читается: проверьте, что это выгрузка Битрикс24 (CSV или Excel) с шапкой в первой строке.',
  storage: 'Хранилище файлов недоступно. Попробуйте ещё раз через минуту.',
  http_404:
    'Миграция из Битрикс24 выключена — включите флаг bitrix_migration в системных настройках.',
  http_413: `Файл больше ${IMPORT_MAX_FILE_MB} МБ — разбейте выгрузку по периодам.`,
};

export function BitrixUploadForm() {
  const [files, setFiles] = useState<UploadedFile[] | null>(null);
  const { formAction, pending, errorText } = useFetchSubmit<UploadResponse>({
    url: '/api/admin/bitrix/upload',
    body: (fd) => fd,
    errorMap: ERROR_LABELS,
    onSuccess: (data) => setFiles(data.files ?? []),
  });

  return (
    <section className="space-y-3" aria-labelledby="bitrix-upload-title">
      <form
        action={(fd) => {
          setFiles(null);
          formAction(fd);
        }}
        className="bg-white border border-gray-200 rounded-xl p-4 space-y-3"
      >
        <div>
          <h2 id="bitrix-upload-title" className="font-medium text-gray-900">
            Файлы выгрузки
          </h2>
          <p className="text-sm text-gray-600">
            Выгрузите из Битрикс24 списки компаний, контактов, лидов, сделок и задач (CSV или Excel)
            и загрузите их сюда — что в каком файле, определится по шапке.
          </p>
        </div>
        <div className="flex flex-col gap-0.5">
          <label htmlFor="bitrix-upload-files" className="text-xs text-gray-500">
            Файлы CSV или XLSX
          </label>
          <input
            id="bitrix-upload-files"
            type="file"
            name="files"
            multiple
            required
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="text-sm"
          />
          <p className="text-xs text-gray-500">
            До {BITRIX_UPLOAD_MAX_FILES} файлов за раз, каждый до {IMPORT_MAX_FILE_MB} МБ.
          </p>
        </div>
        {errorText && (
          <p role="alert" className="text-sm text-red-600">
            {errorText}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? 'Проверяем…' : 'Проверить файлы'}
        </Button>
      </form>
      {files && <UploadDiagnostics files={files} />}
    </section>
  );
}

function UploadDiagnostics({ files }: { files: UploadedFile[] }) {
  const stored = files.filter((f) => f.key !== null).length;
  return (
    <div className="space-y-2">
      <TableShell overflow="x-auto">
        <THead>
          <Th>Файл</Th>
          <Th>Сущность</Th>
          <Th>Строк</Th>
          <Th>Колонки</Th>
        </THead>
        <tbody>
          {files.map((f, i) => (
            <Tr key={`${f.name}-${i}`}>
              <Td className="font-medium text-gray-900">{f.name}</Td>
              <Td>{entityCell(f)}</Td>
              <Td>{f.rows}</Td>
              <Td className="text-gray-600">
                {f.unmatchedHeaders.length === 0
                  ? 'все распознаны'
                  : `не распознаны: ${f.unmatchedHeaders.join(', ')}`}
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
      <p className="text-sm text-gray-600" role="status">
        {stored === 0
          ? 'Ни один файл не сохранён: поправьте шапки и загрузите снова.'
          : `Сохранено файлов: ${stored} из ${files.length}. Создание пакета из них — следующий шаг этапа: форма «Новый пакет» появится на этой вкладке.`}
      </p>
    </div>
  );
}

function entityCell(f: UploadedFile): React.ReactNode {
  if (f.entity) return BITRIX_ENTITY_LABELS[f.entity];
  const hint = f.candidate
    ? `похоже на «${BITRIX_ENTITY_LABELS[f.candidate]}», не хватает: ${f.missing.join(', ')}`
    : 'шапка не похожа ни на одну выгрузку Битрикс24';
  return (
    <span className="text-amber-700">
      Не распознан <span className="text-gray-600">({hint})</span>
    </span>
  );
}
