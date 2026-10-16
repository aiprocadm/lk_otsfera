'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { fmtMoney } from '@/lib/format';
import { transitionOrderStatusAction } from '@/server-actions/orderStatuses';
import type { OrderKanban } from '@/lib/services/manager/orders';

/**
 * Канбан заказов (этап 6 ТЗ 13.10.2026, `У-303`, `Р-6-6`).
 *
 * Столбцы — этапы справочника по порядку и «Отменена». Перетаскивание зовёт
 * то же действие, что кнопки в карточке заказа (`transitionOrderStatusAction`),
 * поэтому проверки одни: назад — только руководитель и администратор, закрыть —
 * только при выполненных условиях, отменить — с причиной. Каждый отказ
 * объясняется словами, карточка остаётся на месте.
 */
const UNMET_RU: Record<string, string> = {
  documents_uploaded: 'нет чистого документа',
  accounting_signed: 'бухгалтерия не подписана',
  certificates_issued: 'не выданы удостоверения',
};

const ERROR_RU: Record<string, string> = {
  backward_forbidden: 'Вернуть заказ на предыдущий этап могут руководитель и администратор.',
  status_inactive: 'Этот этап выключен в справочнике статусов.',
  forbidden: 'Нет доступа к этому заказу.',
  not_found: 'Заказ не найден или недоступен.',
};

export function ManagerOrdersKanban({
  board,
  hrefBase = '/manager/orders',
}: {
  board: OrderKanban;
  hrefBase?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState<string | null>(null);

  async function move(orderId: string, toId: string, isTerminal: boolean, reason?: string) {
    const res = await transitionOrderStatusAction({
      orderId,
      toId,
      ...(reason !== undefined ? { reason } : {}),
    });
    if (res.ok) {
      if (res.changed) toast.success('Статус заказа обновлён');
      startTransition(() => router.refresh());
      return;
    }
    if (res.error === 'reason_required' && isTerminal) {
      const why = window.prompt('Причина отмены заказа:');
      if (why && why.trim()) await move(orderId, toId, isTerminal, why.trim());
      return;
    }
    if (res.error === 'completion_conditions_unmet') {
      toast.error(
        `Заказ пока нельзя закрыть: ${res.unmet.map((c) => UNMET_RU[c] ?? c).join(', ')}.`
      );
      return;
    }
    toast.error(ERROR_RU[res.error] ?? 'Не удалось сменить статус заказа.');
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4" data-testid="orders-kanban">
      {board.columns.map((col) => (
        <section
          key={col.id}
          aria-label={col.label}
          onDragOver={(e) => {
            // «Без этапа» — не цель: в него не переводят, из него — уводят.
            if (!col.droppable) return;
            e.preventDefault();
            setDragOver(col.id);
          }}
          onDragLeave={() => setDragOver((s) => (s === col.id ? null : s))}
          onDrop={(e) => {
            if (!col.droppable) return;
            e.preventDefault();
            setDragOver(null);
            const orderId = e.dataTransfer.getData('text/plain');
            const from = e.dataTransfer.getData('application/x-order-status');
            if (orderId && from !== col.id) void move(orderId, col.id, col.isTerminal);
          }}
          className={`min-w-[260px] w-[260px] shrink-0 rounded-xl p-3 transition-colors ${
            dragOver === col.id ? 'bg-[#FFF7ED] ring-2 ring-[#F97316]' : 'bg-[#F3F4F6]'
          }`}
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#111111]">{col.label}</h3>
            <Badge tone={col.isTerminal ? 'warning' : 'neutral'}>{col.orders.length}</Badge>
          </div>
          <div className="space-y-2">
            {col.orders.length === 0 && col.droppable && (
              <p className="text-xs text-gray-500">Перетащите сюда заказ, чтобы сменить этап.</p>
            )}
            {col.orders.map((o) => (
              <article
                key={o.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', o.id);
                  e.dataTransfer.setData('application/x-order-status', col.id);
                }}
                className="cursor-grab rounded-lg border border-gray-200 bg-white p-3 shadow-sm hover:border-[#F97316] active:cursor-grabbing"
              >
                <Link
                  href={`${hrefBase}/${o.id}`}
                  className="text-sm font-medium text-[#111111] hover:text-[#EA580C] hover:underline"
                >
                  {o.orderNumber ? `№${o.orderNumber} · ` : ''}
                  {o.title}
                </Link>
                <p className="mt-1 text-xs text-gray-500">{o.organizationName}</p>
                <p className="text-xs text-gray-500">{fmtMoney(o.totalAmount)}</p>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
