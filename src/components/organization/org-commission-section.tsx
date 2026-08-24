import React from 'react';
import { EmptyState, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import type { OrgRateHistoryRow } from '@/lib/services/commission/rateHistory';

/**
 * Секция «Ставка комиссии» вкладки «Настройки» (`У-99`) — действующая ставка,
 * история изменений и (у тех, кому положено) форма правки.
 *
 * Строго презентационный компонент: право правки решает страница своей роли и
 * передаёт готовую форму. Партнёр форму не получает никогда — `У-3` (решение
 * `Р-4`) запрещает партнёру назначать себе ставку.
 */
const fmtRate = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 2 });

export function OrgCommissionSection({
  rate,
  note,
  history,
  form,
}: {
  /** Доля (0.08 = 8%); `null` — действует базовая ставка партнёра. */
  rate: number | null;
  note: string | null;
  /**
   * История изменений. Не передана — блок не рисуется вовсе: показать пустую
   * историю тому, кому её не отдают, значит соврать «ставку не меняли».
   */
  history?: readonly OrgRateHistoryRow[];
  /** Форма правки — только у администратора и руководителя. */
  form?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[#111111]">
        {rate !== null ? (
          <>
            Действует индивидуальная ставка <strong>{fmtRate.format(rate)}</strong>.
          </>
        ) : (
          'Индивидуальной ставки нет — действует базовая ставка партнёра.'
        )}
        {note && <span className="text-gray-500"> Основание: {note}</span>}
      </p>

      {form}

      {history !== undefined && (
        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-gray-400">История изменений</h3>
          {history.length === 0 ? (
            <EmptyState message="Ставку по этой организации ещё не меняли." />
          ) : (
            <TableShell>
              <THead className="bg-[#F3F4F6]">
                <Th className="py-2 text-[#111111]">Дата</Th>
                <Th className="py-2 text-[#111111]">Было</Th>
                <Th className="py-2 text-[#111111]">Стало</Th>
                <Th className="py-2 text-[#111111]">Кто</Th>
              </THead>
              <tbody>
                {history.map((row) => (
                  <Tr key={row.id} hover={false} className="border-gray-100">
                    <Td className="py-2 text-gray-700">{fmtDate(row.effectiveFrom)}</Td>
                    <Td className="py-2 text-gray-700">
                      {row.oldRate !== null ? fmtRate.format(row.oldRate) : '—'}
                    </Td>
                    <Td className="py-2 text-gray-700">
                      {row.newRate !== null
                        ? fmtRate.format(row.newRate)
                        : 'сброс (ставка партнёра)'}
                    </Td>
                    <Td className="py-2 text-gray-500">{row.changedByName ?? '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </div>
      )}
    </div>
  );
}
