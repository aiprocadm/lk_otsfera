import React from 'react';
import { fmtDate, fmtMoney } from '@/lib/format';
import { STATUS_LABELS } from '@/lib/documents/statusMatrix';
import type { ProposalBlockRow } from '@/lib/services/documents/proposalBlocks';

/**
 * `У-166` (этап 7) — «Коммерческие предложения» отдельным блоком.
 *
 * Один компонент на карточку сделки и карточку организации: строка выглядит
 * одинаково в обоих местах («КП-2026-12 · Отправлен · 120 000 ₽ · отправлено
 * 21.08 · действует до 04.09»). Разъехавшись, эти два списка нарушили бы
 * правило зеркала (§0.2 ТЗ) — один объект должен называться и выглядеть
 * одинаково везде.
 *
 * Пустой список рисуется НИЧЕМ: у сделки или клиента без предложений заголовок
 * с пустотой под ним только занимает место и ничего не сообщает. Про «что
 * делать дальше» (§15) отвечает кнопка выпуска документа рядом — она есть и
 * без этого блока.
 */
export function ProposalsBlock({
  rows,
  hrefBase,
}: {
  rows: ProposalBlockRow[];
  /** Куда ведёт номер: у каждого кабинета сотрудника свой раздел документов. */
  hrefBase: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-[#111111]">Коммерческие предложения</h3>
      <ul className="divide-y divide-gray-100 text-sm">
        {rows.map((p) => (
          <li key={p.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
            <a href={`${hrefBase}/${p.id}`} className="text-[#EA580C] underline">
              {p.number ?? 'без номера'}
            </a>
            <span className="text-gray-500">
              {(STATUS_LABELS as Record<string, string>)[p.status] ?? p.status}
            </span>
            {p.amountGross && <span>{fmtMoney(p.amountGross)}</span>}
            <span className="text-gray-500">
              {p.sentAt ? `отправлено ${fmtDate(p.sentAt)}` : 'не отправлено'}
            </span>
            <span className="text-gray-500">
              {p.validUntil ? `действует до ${fmtDate(p.validUntil)}` : 'без срока'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
