'use client';

import React, { useState } from 'react';
import { dismissQueueRowAction } from '@/server-actions/payment-import';

export type QueueRow = {
  id: string; externalId: string; paidAt: string; amount: string; isRefund: boolean;
  purpose: string | null; counterpartyName: string | null; counterpartyInn: string | null;
  accountCandidates: string[]; candidateOrgName: string | null; matchMethod: string | null;
};

export function PaymentQueueTable({ rows }: { rows: QueueRow[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = rows.filter((r) => !hidden.has(r.id));
  if (visible.length === 0) return <p className="text-sm text-gray-500">Очередь пуста — все оплаты сопоставлены.</p>;

  async function dismiss(id: string) {
    await dismissQueueRowAction({ rowId: id });
    setHidden((s) => new Set(s).add(id));
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border border-gray-200 rounded">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th scope="col" className="text-left px-3 py-2 font-medium">Документ</th>
            <th scope="col" className="text-left px-3 py-2 font-medium">Дата</th>
            <th scope="col" className="text-left px-3 py-2 font-medium">Сумма</th>
            <th scope="col" className="text-left px-3 py-2 font-medium">Контрагент</th>
            <th scope="col" className="text-left px-3 py-2 font-medium">№ счёта (кандидаты)</th>
            <th scope="col" className="text-left px-3 py-2 font-medium">Предложение</th>
            <th scope="col" className="text-left px-3 py-2 font-medium">Действия</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="px-3 py-1.5 text-gray-700">{r.externalId}{r.isRefund ? ' (возврат)' : ''}</td>
              <td className="px-3 py-1.5 text-gray-700">{new Date(r.paidAt).toLocaleDateString('ru-RU')}</td>
              <td className="px-3 py-1.5 text-gray-700">{r.amount}</td>
              <td className="px-3 py-1.5 text-gray-700">{r.counterpartyName ?? '—'}{r.counterpartyInn ? ` (ИНН ${r.counterpartyInn})` : ''}</td>
              <td className="px-3 py-1.5 text-gray-700">{r.accountCandidates.join(', ') || '—'}</td>
              <td className="px-3 py-1.5 text-gray-700">{r.candidateOrgName ?? '—'}</td>
              <td className="px-3 py-1.5">
                <button type="button" onClick={() => dismiss(r.id)} className="text-red-600 hover:underline">Отклонить</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-400">Подтверждение привязки к организации/заказу — форма в следующей итерации; сервис resolveQueueRow готов и покрыт тестами.</p>
    </div>
  );
}
