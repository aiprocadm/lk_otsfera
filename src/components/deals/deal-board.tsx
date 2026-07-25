'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Dialog, Input } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { fmtDate, fmtMoney } from '@/lib/format';
import { moveDealAction, winDealAction } from '@/server-actions/deals';
import type { DealBoard as DealBoardData, DealCard, DealColumn } from '@/lib/services/deals/board';
import { DealDialog, type DealDialogOption, type DealDialogTarget } from './deal-dialog';

/**
 * Этап 6 — канбан сделок (клон funnel-board, native dnd). Drop на стадию с
 * якорем lost открывает диалог обязательной причины, на won — подтверждающий
 * диалог «Выиграна — создать заказ» (PR-2: winDealAction создаёт заказ).
 */

const MOVE_ERRORS: Record<string, string> = {
  not_found: 'Сделка не найдена или недоступна.',
  invalid_stage: 'Неизвестная стадия.',
  lifecycle_violation: 'Такой переход недопустим: сделка уже завершена.',
  reason_required: 'Укажите причину проигрыша.',
  won_requires_order: 'Выигрыш оформляется через диалог «Выиграна — создать заказ».',
  forbidden: 'Нет доступа.'
};

const WIN_ERRORS: Record<string, string> = {
  not_found: 'Сделка не найдена или недоступна.',
  lifecycle_violation: 'Такой переход недопустим: сделка уже завершена.',
  forbidden: 'Нет доступа.'
};

function columnAmount(col: DealColumn): string | null {
  let sum = 0;
  let has = false;
  for (const card of col.cards) {
    if (card.amount === null) continue;
    const n = Number(card.amount);
    if (!Number.isFinite(n)) continue;
    sum += n;
    has = true;
  }
  return has ? fmtMoney(sum) : null;
}

export function DealBoard({
  board,
  organizations,
  managers,
  currentUserId
}: {
  board: DealBoardData;
  /** Заданы вместе с currentUserId → клик по открытой сделке открывает редактирование. */
  organizations?: DealDialogOption[];
  managers?: DealDialogOption[];
  currentUserId?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [lostFor, setLostFor] = useState<{ dealId: string; toStageId: string } | null>(null);
  const [wonFor, setWonFor] = useState<{ dealId: string; toStageId: string } | null>(null);
  const [wonError, setWonError] = useState<string | null>(null);
  const [wonBusy, setWonBusy] = useState(false);
  const [editTarget, setEditTarget] = useState<DealDialogTarget | null>(null);
  const canEdit = organizations !== undefined && managers !== undefined && currentUserId !== undefined;

  function openEdit(card: DealCard) {
    // Редактируются только открытые сделки (завершённые сервис отклонит).
    if (!canEdit || card.status !== 'open') return;
    setEditTarget({
      id: card.id,
      title: card.title,
      amount: card.amount,
      organizationId: card.organizationId,
      managerId: card.managerId,
      expectedCloseAt: card.expectedCloseAt,
      orderId: card.orderId
    });
  }

  async function doMove(dealId: string, toStageId: string, lostReason?: string) {
    const fd = new FormData();
    fd.set('dealId', dealId);
    fd.set('toStageId', toStageId);
    if (lostReason) fd.set('lostReason', lostReason);
    const res = await moveDealAction(fd);
    if (!res.ok) {
      if (res.error === 'reason_required') {
        setLostFor({ dealId, toStageId });
        return;
      }
      toast.error(MOVE_ERRORS[res.error] ?? 'Не удалось переместить карточку.');
      return;
    }
    toast.success('Карточка перемещена.');
    startTransition(() => router.refresh());
  }

  function handleDrop(col: DealColumn, dealId: string) {
    if (col.stage.statusAnchor === 'lost') {
      setLostFor({ dealId, toStageId: col.stage.id });
      return;
    }
    if (col.stage.statusAnchor === 'won') {
      setWonError(null);
      setWonFor({ dealId, toStageId: col.stage.id });
      return;
    }
    void doMove(dealId, col.stage.id);
  }

  async function doWin() {
    if (!wonFor) return;
    setWonBusy(true);
    const fd = new FormData();
    fd.set('dealId', wonFor.dealId);
    fd.set('toStageId', wonFor.toStageId);
    const res = await winDealAction(fd);
    setWonBusy(false);
    if (!res.ok) {
      if (res.error === 'org_required') {
        // Диалог не закрываем: пользователь должен сначала привязать организацию.
        setWonError('У сделки не указана организация — откройте сделку и привяжите организацию.');
        return;
      }
      setWonFor(null);
      toast.error(WIN_ERRORS[res.error] ?? 'Не удалось создать заказ.');
      return;
    }
    setWonFor(null);
    toast.success(
      <span>
        Сделка выиграна, заказ создан —{' '}
        <a href={`/manager/orders/${res.orderId}`} className="underline text-[#F97316]">
          открыть заказ
        </a>
      </span>
    );
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {board.columns.map((col) => {
        const amount = columnAmount(col);
        return (
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
              const dealId = e.dataTransfer.getData('text/plain');
              if (dealId) handleDrop(col, dealId);
            }}
            className={`min-w-[260px] w-[260px] shrink-0 rounded-xl p-3 transition-colors ${
              dragOver === col.stage.id ? 'bg-[#FFF7ED] ring-2 ring-[#F97316]' : 'bg-[#F3F4F6]'
            }`}
          >
            {/* Полоска рендерится ВСЕГДА (transparent-плейсхолдер) — иначе заголовки цветных
                и бесцветных колонок разъезжаются по вертикали. Цвет — data-driven из БД
                (DealStageView.color), не brand-hex UI-палитры. */}
            <div
              aria-hidden
              data-testid="stage-color-strip"
              className="h-1 rounded-full mb-2"
              style={{ background: col.stage.color ?? 'transparent' }}
            />
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-[#111111]">{col.stage.name}</h3>
              <Badge tone="neutral">{col.cards.length}</Badge>
            </div>
            <p className="text-xs text-gray-500 mb-2">{amount ?? '—'}</p>
            <div className="space-y-2">
              {col.cards.map((card) => (
                <article
                  key={card.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', card.id)}
                  onClick={() => openEdit(card)}
                  className="bg-white border border-gray-200 rounded-lg p-3 cursor-grab active:cursor-grabbing shadow-sm"
                >
                  <p className="text-sm font-medium text-[#111111]">{card.title}</p>
                  {card.organizationName && <p className="text-xs text-gray-500 mt-0.5">{card.organizationName}</p>}
                  <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                    <span>{card.amount ? fmtMoney(card.amount) : '—'}</span>
                    <span>{card.managerName ?? 'без ответственного'}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{fmtDate(card.expectedCloseAt ?? card.createdAt)}</p>
                </article>
              ))}
              {col.cards.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Пусто</p>}
            </div>
          </div>
        );
      })}

      <Dialog open={!!lostFor} onClose={() => setLostFor(null)} title="Причина проигрыша" size="sm">
        <form
          onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            // defense-in-depth: the `lostReason` input is always present (static JSX) and
            // `required`, so `FormData.get('lostReason')` is always a non-null string once
            // the form can submit; the `?? ''` fallback guards a shape that can't occur.
            /* v8 ignore next */
            const lostReason = String(new FormData(e.currentTarget).get('lostReason') ?? '');
            const target = lostFor;
            setLostFor(null);
            if (target) void doMove(target.dealId, target.toStageId, lostReason);
          }}
          className="space-y-3"
        >
          <Input name="lostReason" required autoFocus placeholder="Укажите причину проигрыша" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setLostFor(null)}>
              Отмена
            </Button>
            <Button type="submit" variant="danger">
              Отметить проигранной
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={!!wonFor}
        onClose={() => setWonFor(null)}
        title="Отметить сделку выигранной?"
        size="sm"
        busy={wonBusy}
        error={wonError}
      >
        <p className="text-sm text-gray-600 mb-3">
          Из выигранной сделки сразу будет создан заказ.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setWonFor(null)} disabled={wonBusy}>
            Отмена
          </Button>
          <Button type="button" onClick={() => void doWin()} disabled={wonBusy}>
            {wonBusy ? 'Создаю заказ…' : 'Выиграна — создать заказ'}
          </Button>
        </div>
      </Dialog>

      {canEdit && editTarget && (
        <DealDialog
          target={editTarget}
          organizations={organizations}
          managers={managers}
          currentUserId={currentUserId}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}
