'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input } from '@/components/ui';
import { errorMessageRu } from '@/lib/errors/messages';
import { toast } from '@/lib/ui/toast';

/**
 * Сроки обучения по позиции заявки (`У-284`, `Р-2-3`, этап 2 ТЗ 13.10.2026).
 *
 * Задаёт сотрудник ЦО прямо в строке слушателя: слушатель видит сроки в «Мой
 * профиль», а за три дня до окончания ему приходит напоминание. Обе даты
 * необязательные; правило «окончание не раньше начала» проверяет сервер
 * (`setEnrollmentItemDates`), здесь — только подсказка браузеру (`min`).
 */
export function EnrollmentItemDatesForm({
  requestId,
  itemId,
  startsOn,
  endsOn,
}: {
  requestId: string;
  itemId: string;
  /** `YYYY-MM-DD` или null. */
  startsOn: string | null;
  endsOn: string | null;
}) {
  const router = useRouter();
  const [start, setStart] = useState(startsOn ?? '');
  const [end, setEnd] = useState(endsOn ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = start !== (startsOn ?? '') || end !== (endsOn ?? '');

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/enrollments/${requestId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'setItemDates', itemId, startsOn: start, endsOn: end }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          data.error === 'validation'
            ? 'Окончание обучения не может быть раньше начала.'
            : errorMessageRu(data.error ?? 'internal')
        );
        return;
      }
      toast.success('Сроки обучения сохранены');
      router.refresh();
    } catch {
      setError('Нет связи с сервером — попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  const startId = `item-${itemId}-starts`;
  const endId = `item-${itemId}-ends`;
  return (
    <div className="w-full flex flex-wrap items-end gap-3 pt-1">
      <Field htmlFor={startId} label="Начало обучения">
        <Input
          id={startId}
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          disabled={busy}
        />
      </Field>
      <Field htmlFor={endId} label="Окончание обучения">
        <Input
          id={endId}
          type="date"
          value={end}
          min={start || undefined}
          onChange={(e) => setEnd(e.target.value)}
          disabled={busy}
        />
      </Field>
      <Button size="sm" variant="secondary" loading={busy} disabled={!dirty} onClick={save}>
        Сохранить сроки
      </Button>
      {error && (
        <p role="alert" className="w-full text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
