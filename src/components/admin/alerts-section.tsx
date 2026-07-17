import React from 'react';
import { Badge, EmptyState, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import type { AlertStateRow } from '@/lib/services/admin/alerts';

/**
 * G2: секция «Алерты» на /admin/health — read-only обзор состояний алертов
 * (AlertState). Server-компонент: данные загружает страница через
 * listAlertStates; интерактива нет — алерты вычисляет и разрешает воркер.
 */
export function AlertsSection({ alerts }: { alerts: AlertStateRow[] }) {
  return (
    <section className='space-y-3'>
      <div>
        <h2 className='text-base font-semibold text-[#111111]'>Алерты</h2>
        <p className='text-sm text-gray-500 mt-0.5'>
          Вычисляются воркером каждые 5 минут (monitoring.evaluateAlerts): firing — условие
          выполняется сейчас, resolved — уже нет.
        </p>
      </div>
      {alerts.length === 0 ? (
        <EmptyState message='Алертов нет — система в порядке' className='p-8' />
      ) : (
        <TableShell overflow='x-auto'>
          <THead>
            <Th>Ключ</Th>
            <Th>Severity</Th>
            <Th>Статус</Th>
            <Th>Сообщение</Th>
            <Th className='text-right'>Значение</Th>
            <Th>Первое срабатывание</Th>
            <Th>Уведомлён</Th>
            <Th>Разрешён</Th>
          </THead>
          <tbody>
            {alerts.map((a) => (
              <Tr key={a.key}>
                <Td className='font-mono text-xs text-gray-600'>{a.key}</Td>
                <Td>
                  <Badge tone={a.severity === 'critical' ? 'danger' : 'warning'}>{a.severity}</Badge>
                </Td>
                <Td>
                  {a.status === 'firing' ? (
                    <Badge tone='danger' className='font-semibold'>firing</Badge>
                  ) : (
                    <Badge tone='neutral'>{a.status}</Badge>
                  )}
                </Td>
                <Td className='text-gray-700'>{a.message}</Td>
                <Td className='text-right tabular-nums text-gray-700'>{a.value ?? '—'}</Td>
                <Td className='text-gray-500 text-xs'>{fmtDateTime(a.firstSeenAt)}</Td>
                <Td className='text-gray-500 text-xs'>{fmtDateTime(a.lastNotifiedAt)}</Td>
                <Td className='text-gray-500 text-xs'>{a.resolvedAt ? fmtDateTime(a.resolvedAt) : '—'}</Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </section>
  );
}
