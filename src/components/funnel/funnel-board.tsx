'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Dialog, Input } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { moveFunnelLeadAction } from '@/server-actions/funnel';
import type { FunnelBoard as FunnelBoardData } from '@/lib/services/funnel/board';

const MOVE_ERRORS: Record<string, string> = {
  org_required: 'Сначала привяжите организацию к лиду.',
  reason_required: 'Укажите причину отказа.',
  lifecycle_violation: 'Такой переход недопустим.',
  invalid_stage: 'Неизвестная стадия.',
  not_found: 'Лид не найден или недоступен.',
  forbidden: 'Нет доступа.'
};

export function FunnelBoard({ board }: { board: FunnelBoardData }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<{ leadId: string; toStageId: string } | null>(null);

  async function doMove(leadId: string, toStageId: string, reason?: string) {
    const fd = new FormData();
    fd.set('leadId', leadId);
    fd.set('toStageId', toStageId);
    if (reason) fd.set('reason', reason);
    const res = await moveFunnelLeadAction(fd);
    if (!res.ok) {
      if (res.error === 'reason_required') {
        setReasonFor({ leadId, toStageId });
        return;
      }
      toast.error(MOVE_ERRORS[res.error] ?? 'Не удалось переместить карточку.');
      return;
    }
    toast.success('Карточка перемещена.');
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {board.columns.map((col) => (
        <div
          key={col.stage.id}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(col.stage.id);
          }}
          onDragLeave={() => setDragOver((s) => (s === col.stage.id ? null : s))}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(null);
            const leadId = e.dataTransfer.getData('text/plain');
            if (leadId) void doMove(leadId, col.stage.id);
          }}
          className={`min-w-[260px] w-[260px] shrink-0 rounded-xl p-3 transition-colors ${
            dragOver === col.stage.id ? 'bg-[#FFF7ED] ring-2 ring-[#F97316]' : 'bg-[#F3F4F6]'
          }`}
        >
          {col.stage.color && (
            // data-driven цвет стадии из БД (FunnelStageView.color), не brand-hex UI-палитры.
            <div
              aria-hidden
              data-testid="stage-color-strip"
              className="h-1 rounded-full mb-2"
              style={{ background: col.stage.color }}
            />
          )}
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[#111111]">{col.stage.name}</h3>
            <Badge tone="neutral">{col.cards.length}</Badge>
          </div>
          <div className="space-y-2">
            {col.cards.map((card) => (
              <article
                key={card.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', card.id)}
                className="bg-white border border-gray-200 rounded-lg p-3 cursor-grab active:cursor-grabbing shadow-sm"
              >
                <p className="text-sm font-medium text-[#111111]">{card.clientCompanyName}</p>
                <p className="text-xs text-gray-500 mt-0.5">{card.subject}</p>
                <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                  <span>{card.estimatedAmount ? `${card.estimatedAmount} ₽` : '—'}</span>
                  <span>{card.assignedManagerName ?? 'без менеджера'}</span>
                </div>
              </article>
            ))}
            {col.cards.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Пусто</p>}
          </div>
        </div>
      ))}

      <Dialog open={!!reasonFor} onClose={() => setReasonFor(null)} title="Причина отказа" size="sm">
        <form
          onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            // defense-in-depth: the `reason` input is always present (static JSX) and
            // `required`, so `FormData.get('reason')` is always a non-null string once
            // the form can submit; the `?? ''` fallback guards a shape that can't occur.
            /* v8 ignore next */
            const reason = String(new FormData(e.currentTarget).get('reason') ?? '');
            const target = reasonFor;
            setReasonFor(null);
            if (target) void doMove(target.leadId, target.toStageId, reason);
          }}
          className="space-y-3"
        >
          <Input name="reason" required autoFocus placeholder="Укажите причину отказа" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setReasonFor(null)}>
              Отмена
            </Button>
            <Button type="submit" variant="danger">
              Отклонить
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
