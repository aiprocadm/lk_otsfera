import React from 'react';
import type { DlqRow } from '@/lib/services/admin/queueStats';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { RetryButton } from './retry-button';

function ageLabel(d: Date | null): string {
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}м`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}ч`;
  return `${Math.floor(h / 24)}д`;
}

export function DlqTable({ rows }: { rows: DlqRow[] }) {
  if (rows.length === 0) {
    return <EmptyState message="Все очереди чисты — ни одной упавшей задачи." className="p-8" />;
  }
  return (
    <TableShell overflow="x-auto">
      <THead>
        <Th>Очередь</Th>
        <Th>Job ID</Th>
        <Th>Имя</Th>
        <Th>Причина</Th>
        <Th className="text-right">Попыток</Th>
        <Th className="text-right">Когда</Th>
        <Th className="text-right">Действие</Th>
      </THead>
      <tbody>
        {rows.map((row) => (
          <Tr key={`${row.queue}:${row.jobId}`}>
            <Td className="font-mono text-xs text-gray-600">{row.queue}</Td>
            <Td className="font-mono text-xs text-gray-500">{row.jobId}</Td>
            <Td className="text-gray-700">{row.name}</Td>
            <Td className="text-red-700 text-xs max-w-md">
              <span className="line-clamp-2">{row.failedReason ?? '—'}</span>
            </Td>
            <Td className="text-right tabular-nums text-gray-600">{row.attemptsMade}</Td>
            <Td className="text-right text-gray-500 text-xs">{ageLabel(row.failedAt)}</Td>
            <Td className="text-right">
              <RetryButton queue={row.queue} jobId={row.jobId} />
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}
