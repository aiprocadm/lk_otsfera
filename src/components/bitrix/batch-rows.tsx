import React from 'react';
import { TableShell, THead, Th, Tr, Td } from '@/components/ui/table';
import { BITRIX_ENTITY_TITLES, type PlanRow } from '@/lib/services/bitrix/mapping/types';

/**
 * «О чём нужно решить» и «что пропустим» (`У-193`).
 *
 * Пропуск и конфликт показываются РАЗНЫМИ таблицами намеренно: пропуск — это
 * нормальный исход («файлов у выгрузки нет»), а конфликт требует действия
 * человека и держит кнопку применения закрытой.
 */
export function BatchRows({ rows }: { rows: PlanRow[] }) {
  const conflicts = rows.filter((r) => r.action === 'conflict');
  const skips = rows.filter((r) => r.action === 'skip');

  return (
    <div className="space-y-4">
      {conflicts.length > 0 && (
        <RowsTable
          title="Нужно решение"
          hint="Эти записи не перенесутся, пока причина не устранена."
          rows={conflicts}
          testId="bitrix-conflicts"
        />
      )}
      {skips.length > 0 && (
        <RowsTable
          title="Пропустим"
          hint="Так и задумано: переносить эти записи некуда или незачем."
          rows={skips}
          testId="bitrix-skips"
        />
      )}
      {conflicts.length === 0 && skips.length === 0 && (
        <p className="text-sm text-gray-600">
          Ни конфликтов, ни пропусков: всё, что нашлось в Битрикс24, переносится целиком.
        </p>
      )}
    </div>
  );
}

function RowsTable({
  title,
  hint,
  rows,
  testId,
}: {
  title: string;
  hint: string;
  rows: PlanRow[];
  testId: string;
}) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <div>
        <h3 className="text-sm font-semibold text-[#111111]">
          {title} <span className="text-gray-500">({rows.length})</span>
        </h3>
        <p className="text-sm text-gray-600">{hint}</p>
      </div>
      <TableShell overflow="x-auto">
        <caption className="sr-only">{title}</caption>
        <THead>
          <Th>Что</Th>
          <Th>Запись</Th>
          <Th>Причина</Th>
        </THead>
        <tbody>
          {rows.map((row, i) => (
            <Tr key={`${row.entity}-${row.bitrixId}-${i}`}>
              <Td className="text-gray-600">{BITRIX_ENTITY_TITLES[row.entity]}</Td>
              <Td className="font-medium text-gray-900">{row.title || row.bitrixId}</Td>
              <Td className="text-gray-600">{row.reason}</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </section>
  );
}
