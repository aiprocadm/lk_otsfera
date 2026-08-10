'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Select } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { assignLegacyDirectionAction } from '@/server-actions/enrollments-legacy';

/**
 * Выбор направления для старой заявки (`У-34а`, шаг 2, этап 6).
 *
 * Одна строка списка разбора: выпадающий список направлений + кнопка.
 * Проставляется **позициям** заявки, а не шапке: шапочное поле объявлено
 * устаревшим (`У-36`) и уедет следующим этапом.
 */
export function LegacyDirectionForm({
  requestId,
  directions,
}: {
  requestId: string;
  directions: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(fd: FormData) {
    setBusy(true);
    setError(null);
    try {
      fd.set('requestId', requestId);
      const res = await assignLegacyDirectionAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(`Направление проставлено: позиций — ${res.updated}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      action={(fd) => {
        void submit(fd);
      }}
      className="flex flex-wrap items-center gap-2"
      data-testid={`legacy-form-${requestId}`}
    >
      <Select name="directionId" aria-label="Направление обучения" required className="w-64">
        <option value="">Выберите направление…</option>
        {directions.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>
      <Button type="submit" disabled={busy}>
        {busy ? 'Сохраняю…' : 'Проставить'}
      </Button>
      {error && (
        <span className="text-sm text-red-700" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
