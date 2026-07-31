'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { rewindCursorAction } from '@/server-actions/admin/syncControl';

const ERROR_LABELS: Record<string, string> = {
  validation: 'Проверьте значение даты.',
  unknown_entity: 'Неизвестная сущность.',
  invalid_cursor: 'Недопустимое значение курсора (в будущем или не дата).',
  storage: 'Ошибка записи.',
};

/** Pure gate: confirm is armed only when the typed name matches the entity. */
export function confirmArmed(typed: string, entityName: string): boolean {
  return typed.trim() === entityName;
}

export function SyncCursorDialog({
  entity,
  currentCursor,
}: {
  entity: string;
  currentCursor: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setTyped('');
    setValue('');
    setError(null);
  }

  function submit(reset: boolean) {
    setError(null);
    const fd = new FormData();
    fd.set('entity', entity);
    fd.set('cursor', reset ? '' : value);
    startTransition(async () => {
      const res = await rewindCursorAction(fd);
      if (res.ok) {
        close();
        router.refresh();
      } else {
        setError(ERROR_LABELS[res.error] ?? `Ошибка: ${res.error}`);
      }
    });
  }

  const armed = confirmArmed(typed, entity);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-1 rounded border border-gray-300 hover:border-[#F97316] hover:text-[#F97316] transition-colors"
      >
        Курсор…
      </button>

      <Dialog
        open={open}
        onClose={close}
        title={`Перемотка курсора: ${entity}`}
        size="md"
        busy={pending}
        error={error ?? undefined}
      >
        <div className="space-y-3">
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
            ⚠️ Перемотка вызовет повторный pull всех изменений 1С с указанного момента. Сброс
            (пустое поле) = полный re-pull с начала. Текущий курсор:{' '}
            <span className="font-mono">{currentCursor ?? '—'}</span>.
          </p>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Новый курсор (дата/время)
            </span>
            <input
              type="datetime-local"
              value={value}
              onChange={(e) =>
                setValue(e.target.value ? new Date(e.target.value).toISOString() : '')
              }
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Для подтверждения введите имя сущности: <span className="font-mono">{entity}</span>
            </span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
            />
          </label>
          <div className="flex justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={!armed || pending}
              className="px-3 py-2 border border-red-300 text-red-700 text-sm rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              Сбросить (полный re-pull)
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={close}
                className="px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => submit(false)}
                disabled={!armed || pending || value === ''}
                className="px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] disabled:opacity-50"
              >
                {pending ? 'Применяем…' : 'Перемотать'}
              </button>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
