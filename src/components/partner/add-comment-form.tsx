'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const MAX_LEN = 5000;

export function AddCommentForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;

    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId, body: trimmed })
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        setError(typeof errBody.error === 'string' ? errBody.error : 'Не удалось отправить комментарий');
        return;
      }
      setBody('');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className='space-y-2 pt-3 border-t border-gray-100'>
      <label className='block'>
        <span className='sr-only'>Новый комментарий</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={MAX_LEN}
          placeholder='Написать комментарий…'
          className='border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316] resize-y'
        />
      </label>

      {error && (
        <div className='text-sm text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2'>
          {error}
        </div>
      )}

      <div className='flex items-center justify-between'>
        <span className='text-xs text-gray-400'>
          {body.length}/{MAX_LEN}
        </span>
        <button
          type='submit'
          disabled={submitting || body.trim().length === 0}
          className='px-3 py-1.5 text-sm bg-[#F97316] text-white rounded-lg hover:bg-[#EA580C] disabled:opacity-50'
        >
          {submitting ? 'Отправка…' : 'Отправить'}
        </button>
      </div>
    </form>
  );
}
