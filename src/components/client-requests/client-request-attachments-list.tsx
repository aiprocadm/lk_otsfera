'use client';
import React, { useState } from 'react';

export type ClientRequestAttachmentRowVM = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  createdByUserName: string | null;
};

type Props = {
  requestId: string;
  rows: ClientRequestAttachmentRowVM[];
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function mimeIcon(mime: string): string {
  if (mime === 'application/pdf') return 'PDF';
  if (mime === 'image/jpeg' || mime === 'image/png') return 'IMG';
  if (mime.includes('wordprocessingml')) return 'DOC';
  if (mime.includes('spreadsheetml')) return 'XLS';
  return 'FILE';
}

/**
 * Список вложений обращения клиента (этап 5) — sibling
 * `partner/lead-attachments-list`. Скачивание — POST download-роут →
 * { downloadUrl } (presigned), затем переход по ссылке; 410 = карантин.
 */
export function ClientRequestAttachmentsList({ requestId, rows }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(id: string) {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/client-requests/${requestId}/attachments/${id}/download`, {
        method: 'POST',
      });
      if (!res.ok) {
        if (res.status === 410) setError('Файл помещён в карантин антивирусом');
        else {
          const body = await res.json().catch(() => null);
          setError(body?.error ?? `Ошибка скачивания: ${res.status}`);
        }
        return;
      }
      const body = (await res.json()) as { downloadUrl: string };
      window.open(body.downloadUrl, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети');
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return <div className="text-sm text-gray-500">Пока нет вложений</div>;
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-center gap-3 px-3 py-2 bg-white border border-gray-200 rounded-lg"
          >
            <span className="inline-flex items-center justify-center min-w-12 px-2 h-6 text-[10px] font-semibold rounded bg-gray-100 text-gray-700">
              {mimeIcon(r.mimeType)}
            </span>
            <div className="flex-1 min-w-0">
              <button
                type="button"
                onClick={() => download(r.id)}
                disabled={busyId === r.id}
                className="text-sm text-[#111111] hover:text-[#F97316] truncate block text-left disabled:opacity-50"
              >
                {busyId === r.id ? 'Готовим ссылку…' : r.name}
              </button>
              <div className="text-xs text-gray-500">
                {fmtSize(r.size)} · {fmtDate(r.createdAt)}
                {r.createdByUserName && <> · {r.createdByUserName}</>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
