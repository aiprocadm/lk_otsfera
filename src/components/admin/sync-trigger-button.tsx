'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { triggerSyncAction } from '@/server-actions/admin/syncControl';

const ERROR_LABELS: Record<string, string> = {
  validation: 'Некорректный запрос.',
  unknown_entity: 'Неизвестная сущность.',
  already_running: 'Синк уже выполняется.',
  queue_unavailable: 'Очередь недоступна (Redis).',
};

export function SyncTriggerButton({ entity }: { entity: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onClick() {
    setErr(null);
    const fd = new FormData();
    fd.set('entity', entity);
    startTransition(async () => {
      const res = await triggerSyncAction(fd);
      if (res.ok) router.refresh();
      else setErr(ERROR_LABELS[res.error] ?? `Ошибка: ${res.error}`);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-xs px-2 py-1 rounded border border-gray-300 hover:border-[#F97316] hover:text-[#F97316] transition-colors disabled:opacity-50"
      >
        {pending ? 'Запуск…' : 'Запустить'}
      </button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </div>
  );
}
