import React from 'react';
import type { AuditRow } from '@/lib/services/admin/auditLog';
import { AuditDetailButton } from './audit-detail-button';

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'medium'
});

export function AuditLogTable({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
        Записей аудита не найдено
      </div>
    );
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-left">
            <th scope='col' className="px-4 py-2.5 font-medium text-gray-600">Когда</th>
            <th scope='col' className="px-4 py-2.5 font-medium text-gray-600">Actor</th>
            <th scope='col' className="px-4 py-2.5 font-medium text-gray-600">Action</th>
            <th scope='col' className="px-4 py-2.5 font-medium text-gray-600">Entity</th>
            <th scope='col' className="px-4 py-2.5 font-medium text-gray-600">ID</th>
            <th scope='col' className="px-4 py-2.5 font-medium text-gray-600 text-right">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-gray-50 hover:bg-[#FFF7ED]">
              <td className="px-4 py-2.5 text-gray-500 text-xs">
                {dateFormatter.format(row.createdAt)}
              </td>
              <td className="px-4 py-2.5">
                {row.actor ? (
                  <>
                    <div>{row.actor.name}</div>
                    <div className="text-xs text-gray-400">{row.actor.email}</div>
                  </>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs">{row.action}</td>
              <td className="px-4 py-2.5 text-gray-600">{row.entity}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{row.entityId}</td>
              <td className="px-4 py-2.5 text-right">
                <AuditDetailButton row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
