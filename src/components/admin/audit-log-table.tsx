import React from 'react';
import type { AuditRow } from '@/lib/services/admin/auditLog';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import {
  AUDIT_TABLE_HEADERS,
  auditActionLabel,
  auditEntityLabel,
  auditStatusLabel,
  formatAuditDateTime,
} from '@/lib/audit/labels';
import { AuditDetailButton } from './audit-detail-button';

/** Итог операции лежит в `meta.status` (пишет `recordAudit`); по умолчанию — успех. */
function statusOf(meta: AuditRow['meta']): string {
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const value = (meta as Record<string, unknown>).status;
    if (typeof value === 'string') return value;
  }
  return 'success';
}

export function AuditLogTable({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) {
    return <EmptyState message="Записей аудита не найдено" className="p-8" />;
  }
  return (
    <TableShell>
      <THead>
        <Th>{AUDIT_TABLE_HEADERS.when}</Th>
        <Th>{AUDIT_TABLE_HEADERS.actor}</Th>
        <Th>{AUDIT_TABLE_HEADERS.action}</Th>
        <Th>{AUDIT_TABLE_HEADERS.entity}</Th>
        <Th>{AUDIT_TABLE_HEADERS.result}</Th>
        <Th>{AUDIT_TABLE_HEADERS.id}</Th>
        <Th className="text-right">{AUDIT_TABLE_HEADERS.detail}</Th>
      </THead>
      <tbody>
        {rows.map((row) => {
          const status = statusOf(row.meta);
          return (
            <Tr key={row.id}>
              {/* data-testid — якорь маски визуальных снапшотов: время события
                  всегда «сейчас» на свежей seed-базе, иначе эталон протухает. */}
              <Td
                className="text-gray-500 text-xs whitespace-nowrap"
                data-testid="audit-created-at"
              >
                {formatAuditDateTime(row.createdAt)}
              </Td>
              <Td>
                {row.actor ? (
                  <>
                    <div>{row.actor.name}</div>
                    <div className="text-xs text-gray-400">{row.actor.email}</div>
                  </>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </Td>
              <Td>{auditActionLabel(row.action)}</Td>
              <Td className="text-gray-600">{auditEntityLabel(row.entity)}</Td>
              <Td className={status === 'success' ? 'text-gray-600' : 'text-red-600'}>
                {auditStatusLabel(status)}
              </Td>
              {/* Идентификатор записи — данные, а не интерфейс: остаётся как есть (ТЗ §6.4.6). */}
              <Td className="font-mono text-xs text-gray-500">{row.entityId}</Td>
              <Td className="text-right">
                <AuditDetailButton row={row} />
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}
