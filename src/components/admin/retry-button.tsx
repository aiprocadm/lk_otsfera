'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RetryButton({ queue, jobId }: { queue: string; jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/admin/dlq/${encodeURIComponent(queue)}/${encodeURIComponent(jobId)}/retry`,
        {
          method: 'POST',
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Retry failed');
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
        className="text-xs px-2 py-1 rounded border border-gray-300 hover:border-[#F97316] hover:text-[#F97316] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Повтор…' : 'Повторить'}
      </button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </div>
  );
}
