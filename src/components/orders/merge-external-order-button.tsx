'use client';
import React, { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  listMergeTargetsAction,
  mergeExternalOrderAction,
} from '@/server-actions/orders/mergeExternal';
import type { MergeTarget } from '@/lib/services/orders/mergeExternal';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { toast } from '@/lib/ui/toast';

/**
 * «Это тот же заказ, что …» (`У-197`, `В-2-4`).
 *
 * Миграция заводит заказ-историю, когда похожего заказа 1С не нашла сама.
 * Человек знает больше машины: он видит, что счёт в 1С и сделка в Битриксе —
 * одна работа. Кнопка переносит на заказ 1С всё, что миграция привязала к
 * своему, и убирает дубль.
 *
 * Кнопка показывается только у заказа из Битрикса и только администратору или
 * руководителю — это же проверяет сервер, кнопка лишь не мозолит глаза.
 */
const ERROR_LABELS: Record<string, string> = {
  forbidden: 'Объединять заказы могут администратор и руководитель.',
  not_found: 'Заказ не найден.',
  validation: 'Выберите заказ из 1С.',
  not_bitrix_order: 'Объединять можно только заказ, перенесённый из Битрикс24.',
  same_order: 'Это один и тот же заказ.',
  other_organization: 'Заказы принадлежат разным организациям.',
  target_is_bitrix: 'Второй заказ тоже из Битрикс24 — выберите заказ из 1С.',
  has_payments: 'На заказе из Битрикс24 есть оплаты — объединение отменено.',
  has_lines: 'На заказе из Битрикс24 есть строки или слушатели — объединение отменено.',
  has_activity: 'На заказе из Битрикс24 уже есть переписка или файлы — объединение отменено.',
  target_has_deal: 'К заказу из 1С уже привязана другая сделка.',
};

export function MergeExternalOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<MergeTarget[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listMergeTargetsAction(orderId).then((res) => {
      if (cancelled) return;
      if (res.ok) setTargets(res.targets);
      else {
        setTargets([]);
        setError(resolveErrorText(res.error, ERROR_LABELS));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  function submit(): void {
    if (!chosen) return;
    setError(null);
    startTransition(async () => {
      const res = await mergeExternalOrderAction({ sourceOrderId: orderId, targetOrderId: chosen });
      if (!res.ok) {
        setError(resolveErrorText(res.error, ERROR_LABELS));
        return;
      }
      setOpen(false);
      toast.success('Заказы объединены');
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Это тот же заказ, что…
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Объединить с заказом из 1С"
        busy={pending}
        error={error}
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Сделка, документы, задачи и заметки перейдут на выбранный заказ, а этот — перенесённый
            из Битрикс24 — будет удалён.
          </p>
          {targets === null ? (
            <p className="text-sm text-gray-500">Ищем заказы этой организации…</p>
          ) : targets.length === 0 ? (
            <p className="text-sm text-gray-600">
              У этой организации нет заказов из 1С, с которыми можно объединить.
            </p>
          ) : (
            <ul aria-label="Заказы из 1С" className="space-y-1 max-h-64 overflow-y-auto">
              {targets.map((t) => (
                <li key={t.id}>
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="merge-target"
                      value={t.id}
                      checked={chosen === t.id}
                      onChange={() => setChosen(t.id)}
                      className="mt-1"
                    />
                    <span>
                      {t.label}
                      <span className="block text-xs text-gray-500">
                        {t.totalAmount} ₽{t.closedAt ? ` · закрыт ${formatDate(t.closedAt)}` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={submit} disabled={pending || !chosen}>
              {pending ? 'Объединяем…' : 'Объединить'}
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

function formatDate(value: Date | string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' }).format(new Date(value));
}
