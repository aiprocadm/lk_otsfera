import React from 'react';
import Link from 'next/link';
import { TableShell, THead, Th, Tr, Td } from '@/components/ui/table';
import type { BitrixHistoryItem } from '@/lib/services/bitrix/history';
import { batchHref, reportHref } from './hrefs';
import { RollbackBatchButton } from './rollback-batch-button';

/**
 * История пакетов (`У-198`): дата, кто запустил, откуда брали данные, что
 * получилось, отчёт сверки и откат. Строка ведёт в карточку пакета, где видно
 * то же самое подробнее.
 */
export const BATCH_STATUS_LABELS: Record<string, string> = {
  preview_pending: 'Считаем предпросмотр',
  preview: 'Предпросмотр готов',
  applying: 'Применяем',
  applied: 'Применён',
  rolling_back: 'Откатываем',
  rolled_back: 'Откачен',
  rollback_partial: 'Откачен частично',
  failed: 'Не удалось',
};

const SOURCE_LABELS: Record<string, string> = {
  rest: 'Портал по вебхуку',
  file: 'Загруженные выгрузки',
};

export function BatchList({ batches }: { batches: BitrixHistoryItem[] }) {
  return (
    <TableShell overflow="x-auto">
      <caption className="sr-only">Пакеты миграции из Битрикс24</caption>
      <THead>
        <Th>Пакет</Th>
        <Th>Источник</Th>
        <Th>Состояние</Th>
        <Th>Записей</Th>
        <Th>Отчёт сверки</Th>
        <Th>Откат</Th>
      </THead>
      <tbody>
        {batches.map((batch) => (
          <Tr key={batch.id}>
            <Td>
              {/* Голая дата в ссылке звучит одинаково у всех строк списка —
                  читалка должна произносить, куда ведёт каждая. */}
              <Link href={batchHref(batch.id)} className="text-[#EA580C] hover:underline">
                {`Пакет от ${formatDate(batch.createdAt)}`}
              </Link>
              <div className="text-xs text-gray-500">{batch.importedByName}</div>
            </Td>
            <Td className="text-gray-600">{SOURCE_LABELS[batch.source] ?? batch.source}</Td>
            <Td>
              {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
              {/* От даты применения считается окно отката в 30 дней — без неё
                  подпись «срок вышел» выглядела бы взятой с потолка. */}
              {batch.rolledBackAt ? (
                <div className="text-xs text-gray-500">{`откачен ${formatDate(batch.rolledBackAt)}`}</div>
              ) : batch.appliedAt ? (
                <div className="text-xs text-gray-500">{`применён ${formatDate(batch.appliedAt)}`}</div>
              ) : null}
            </Td>
            <Td className="text-gray-600">{batch.counts ? batch.counts.total : '—'}</Td>
            <Td>
              {batch.hasReport ? (
                <a
                  href={reportHref(batch.id)}
                  className="text-[#EA580C] hover:underline"
                  // Пятьдесят ссылок «Скачать» подряд читалка произносит
                  // одинаково — человек не понимает, какой пакет качает.
                  aria-label={`Скачать отчёт сверки пакета от ${formatDate(batch.createdAt)}`}
                  data-testid={`bitrix-report-${batch.id}`}
                >
                  Скачать
                </a>
              ) : (
                <span
                  className="text-xs text-gray-500"
                  title="Отчёт появится после применения пакета"
                >
                  пока нечего сверять
                </span>
              )}
            </Td>
            <Td>
              <RollbackBatchButton
                batchId={batch.id}
                state={batch.rollback}
                hint={batch.rollbackHint}
              />
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

export function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(value);
}
