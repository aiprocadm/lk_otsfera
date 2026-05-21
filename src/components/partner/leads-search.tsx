'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

export function LeadsSearch() {
  const router = useRouter();
  const sp = useSearchParams();
  const [value, setValue] = useState(sp.get('search') ?? '');
  const [isPending, startTransition] = useTransition();

  function apply(next: string) {
    const params = new URLSearchParams(sp.toString());
    if (next) params.set('search', next);
    else params.delete('search');
    params.delete('skip');
    startTransition(() =>
      router.replace(`/partner/leads${params.toString() ? '?' + params.toString() : ''}`)
    );
  }

  return (
    <div className='flex gap-2 items-center'>
      <input
        type='search'
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply(value);
        }}
        placeholder='Клиент, ИНН, тема…'
        className='border border-gray-200 rounded-lg px-3 py-2 text-sm w-full md:w-72 focus:outline-none focus:border-[#F97316]'
      />
      <button
        onClick={() => apply(value)}
        className='px-3 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] disabled:opacity-50'
        disabled={isPending}
      >
        Найти
      </button>
    </div>
  );
}
