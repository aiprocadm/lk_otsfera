import React from 'react';
import Link from 'next/link';
import { TableShell, THead, Th, Tr, Td } from '@/components/ui/table';
import type { BitrixBatchView } from '@/lib/services/bitrix/preview';
import { batchHref } from './hrefs';

/**
 * История пакетов (`У-198`, начало): дата, кто запустил, откуда брали данные,
 * что получилось. Отчёт сверки и кнопка отката приезжают следующими шагами
 * этапа — до них строка ведёт в карточку пакета, где видно всё то же самое.
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

export function BatchList({ batches }: { batches: BitrixBatchView[] }) {
  return (
    <TableShell overflow="x-auto">
      <caption className="sr-only">Пакеты миграции из Битрикс24</caption>
      <THead>
        <Th>Пакет</Th>
        <Th>Источник</Th>
        <Th>Состояние</Th>
        <Th>Записей</Th>
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
            <Td>{BATCH_STATUS_LABELS[batch.status] ?? batch.status}</Td>
            <Td className="text-gray-600">{batch.counts ? batch.counts.total : '—'}</Td>
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
