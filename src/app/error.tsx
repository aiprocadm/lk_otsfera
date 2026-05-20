'use client';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className='min-h-screen grid place-items-center p-6 bg-slate-50'>
      <div className='text-center space-y-4'>
        <h1 className='text-2xl font-semibold'>Что-то пошло не так</h1>
        <p className='text-slate-500 text-sm'>Произошла непредвиденная ошибка. Попробуйте ещё раз.</p>
        <button
          onClick={reset}
          className='bg-zinc-900 text-white px-4 py-2 rounded text-sm hover:bg-zinc-700 transition-colors'
        >
          Попробовать снова
        </button>
      </div>
    </main>
  );
}
