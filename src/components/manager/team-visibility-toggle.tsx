'use client';

import React, { useState, useTransition } from 'react';
import { setTeamVisibilityAction } from '@/server-actions/manager/teamVisibility';

export function TeamVisibilityToggle({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onToggle() {
    const next = !enabled;
    setError(null);
    startTransition(async () => {
      const res = await setTeamVisibilityAction({ enabled: next });
      if (res.ok) setEnabled(next);
      else setError('Не удалось изменить режим');
    });
  }

  return (
    <div className="rounded-lg bg-[#F3F4F6] p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium text-[#111111]">Видимость всей команды</p>
          <p className="text-sm text-gray-600">
            {enabled
              ? 'Включено: каждый менеджер видит все заказы компании.'
              : 'Выключено: каждый менеджер видит только свои назначения.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={pending}
          aria-pressed={enabled}
          className={`rounded-md px-4 py-2 text-white ${enabled ? 'bg-[#EA580C]' : 'bg-gray-400'} disabled:opacity-50`}
        >
          {enabled ? 'Включено' : 'Выключено'}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
