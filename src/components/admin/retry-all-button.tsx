'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RetryAllButton({ queue }: { queue: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/dlq/${encodeURIComponent(queue)}/retry-all`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`);
        return;
      }
      setMsg(`Повторно: ${body.retried ?? 0}${body.truncated ? ' (обрезано до 500)' : ''}`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="text-xs px-2 py-1 rounded border border-gray-300 hover:border-[#F97316] hover:text-[#F97316] transition-colors disabled:opacity-50"
      >
        {busy ? 'Повтор…' : 'Повторить все'}
      </button>
      {msg && <span className="text-xs text-gray-600">{msg}</span>}
    </div>
  );
}
