'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { applyBitrixBatchAction } from '@/server-actions/admin/bitrix';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { resolveErrorText } from '@/lib/ui/useFormAction';

/**
 * «Применить пакет» (`У-194`).
 *
 * Перенос спрашивает подтверждение не из вежливости: он пишет в рабочую базу
 * сотни строк, и человек должен видеть, сколько именно, до нажатия. Откат
 * есть, но он дороже, чем прочитать одну фразу.
 */
const ERROR_LABELS: Record<string, string> = {
  forbidden: 'Миграция из Битрикс24 выключена или у вас нет прав на раздел.',
  not_found: 'Пакет не найден — возможно, его удалили.',
  invalid: 'Пакет уже применяется или применён.',
  mapping_incomplete: 'Сначала сопоставьте все стадии сделок и статусы лидов.',
};

export function ApplyBatchButton({
  batchId,
  total,
  disabled,
}: {
  batchId: string;
  /** Сколько записей тронет перенос — число из предпросмотра. */
  total: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(): Promise<void> {
    setPending(true);
    setError(null);
    const res = await applyBitrixBatchAction(batchId);
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
      <Button type="button" disabled={disabled} onClick={() => setOpen(true)}>
        Применить
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Перенести данные из Битрикс24?"
        busy={pending}
        error={error}
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            В личный кабинет будет записано записей: {total}. Организации, контакты, лиды, сделки,
            задачи и заметки появятся так, как показал предпросмотр.
          </p>
          <p className="text-sm text-gray-600">
            Перенос можно откатить в течение 30 дней — каждая запись сохраняется в журнале пакета.
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={() => void confirm()} disabled={pending}>
              {pending ? 'Запускаем…' : 'Да, перенести'}
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
