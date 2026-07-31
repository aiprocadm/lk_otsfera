'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setSchedulePausedAction } from '@/server-actions/admin/syncControl';
import { resolveErrorText } from '@/lib/ui/useFormAction';

export function SyncScheduleToggle({
  schedulerId,
  paused,
}: {
  schedulerId: string;
  paused: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onClick() {
    setErr(null);
    const fd = new FormData();
    fd.set('schedulerId', schedulerId);
    fd.set('paused', String(!paused));
    startTransition(async () => {
      const res = await setSchedulePausedAction(fd);
      if (res.ok) router.refresh();
      // queue_unavailable — админ-специфичный текст; unknown_schedule/validation
      // покрыты центральным словарём (errorMessageRu) через resolveErrorText.
      else
        setErr(resolveErrorText(res.error, { queue_unavailable: 'Очередь недоступна (Redis).' }));
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={`text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
          paused
            ? 'border-yellow-400 text-yellow-700 hover:bg-yellow-50'
            : 'border-gray-300 text-gray-700 hover:border-[#F97316] hover:text-[#F97316]'
        }`}
      >
        {pending ? '…' : paused ? 'На паузе — включить' : 'Активно — пауза'}
      </button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </div>
  );
}
