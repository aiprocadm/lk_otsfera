'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type LeadAttachmentRowVM = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  createdByUserId: string | null;
  createdByUserName: string | null;
};

type Props = {
  leadId: string;
  rows: LeadAttachmentRowVM[];
  canDelete: boolean;
  currentUserId: string;
  isPartnerAdmin: boolean;
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
    minute: '2-digit'
  }).format(new Date(iso));
}

function mimeIcon(mime: string): string {
  if (mime === 'application/pdf') return 'PDF';
  if (mime === 'image/jpeg' || mime === 'image/png') return 'IMG';
  if (mime.includes('wordprocessingml')) return 'DOC';
  if (mime.includes('spreadsheetml')) return 'XLS';
  return 'FILE';
}

export function LeadAttachmentsList({
  leadId,
  rows,
  canDelete,
  currentUserId,
  isPartnerAdmin
}: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!confirm('Удалить вложение?')) return;
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/partner/leads/${leadId}/attachments/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Ошибка удаления: ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети');
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return <div className='text-sm text-gray-500'>Пока нет вложений</div>;
  }

  return (
    <div className='space-y-2'>
      <ul className='space-y-1'>
        {rows.map((r) => {
          const canDeleteThis =
            canDelete && (isPartnerAdmin || r.createdByUserId === currentUserId);
          return (
            <li
              key={r.id}
              className='flex items-center gap-3 px-3 py-2 bg-white border border-gray-200 rounded-lg'
            >
              <span className='inline-flex items-center justify-center min-w-12 px-2 h-6 text-[10px] font-semibold rounded bg-gray-100 text-gray-700'>
                {mimeIcon(r.mimeType)}
              </span>
              <div className='flex-1 min-w-0'>
                <a
                  href={`/api/partner/leads/${leadId}/attachments/${r.id}/download`}
                  className='text-sm text-[#111111] hover:text-[#F97316] truncate block'
                >
                  {r.name}
                </a>
                <div className='text-xs text-gray-500'>
                  {fmtSize(r.size)} · {fmtDate(r.createdAt)}
                  {r.createdByUserName && <> · {r.createdByUserName}</>}
                </div>
              </div>
              {canDeleteThis && (
                <button
                  type='button'
                  onClick={() => handleDelete(r.id)}
                  disabled={busyId === r.id}
                  className='text-xs text-gray-500 hover:text-red-700 px-2 py-1 disabled:opacity-50'
                  aria-label='Удалить вложение'
                >
                  {busyId === r.id ? '…' : 'Удалить'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <div className='text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2'>
          {error}
        </div>
      )}
    </div>
  );
}
