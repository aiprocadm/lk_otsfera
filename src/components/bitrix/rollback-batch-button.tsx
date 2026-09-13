'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { rollbackBitrixBatchAction } from '@/server-actions/admin/bitrix';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import type { RollbackState } from '@/lib/services/bitrix/rollback';

/**
 * «Откатить пакет» (`У-196`).
 *
 * Кнопка неактивна ровно тогда, когда откат невозможен, и всегда говорит
 * почему: «нельзя» без причины — дефект приёмки (§15). Подсказку считает
 * сервис по тем же данным, по которым пойдёт сам откат.
 */
const ERROR_LABELS: Record<string, string> = {
  forbidden: 'Миграция из Битрикс24 выключена или у вас нет прав на раздел.',
  not_found: 'Пакет не найден — возможно, его удалили.',
  not_applied: 'Пакет ещё не применён — возвращать нечего.',
  rolled_back: 'Этот пакет уже откачен.',
  expired: 'Откат возможен 30 дней после применения — срок вышел.',
  nothing_to_revert: 'Применение не записало ни одной строки.',
  in_progress: 'Пакет сейчас в работе — дождитесь окончания, экран обновится сам.',
  queue: 'Очередь фоновых задач недоступна — откат не запущен. Повторите позже.',
};

export function RollbackBatchButton({
  batchId,
  state,
  hint,
}: {
  batchId: string;
  state: RollbackState;
  /** Почему нельзя — показывается всплывающей подсказкой на неактивной кнопке. */
  hint: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(): Promise<void> {
    setPending(true);
    setError(null);
    const res = await rollbackBitrixBatchAction(batchId);
    setPending(false);
    if (!res.ok) {
      setError(resolveErrorText(res.error, ERROR_LABELS));
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button
        type="button"
        variant="danger"
        size="sm"
        disabled={state !== 'available'}
        {...(hint ? { title: hint } : {})}
        onClick={() => setOpen(true)}
        data-testid={`bitrix-rollback-${batchId}`}
      >
        Откатить
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Откатить перенос?"
        busy={pending}
        error={error}
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Записи, созданные этим пакетом, будут удалены, а изменённые — возвращены к прежним
            значениям. Всё, что появилось после переноса, останется на месте.
          </p>
          <p className="text-sm text-gray-600">
            Записи, на которые уже легла работа (оплаты, переписка, новые документы), откатить
            нельзя — они попадут в отчёт сверки со своей причиной.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="danger"
              onClick={() => void confirm()}
              disabled={pending}
              data-testid="bitrix-rollback-confirm"
            >
              {pending ? 'Запускаем…' : 'Да, откатить'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Отмена
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
