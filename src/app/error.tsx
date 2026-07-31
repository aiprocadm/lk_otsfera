'use client';
import { useEffect } from 'react';
import { clientLog } from '@/lib/logging/client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    clientLog.error(error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-[#F97316] rounded-2xl flex items-center justify-center mx-auto mb-6">
          <span className="text-white text-2xl font-bold">!</span>
        </div>
        <h1 className="text-2xl font-bold text-[#111111] mb-2">Что-то пошло не так</h1>
        <p className="text-gray-500 mb-6">Произошла непредвиденная ошибка. Попробуйте ещё раз.</p>
        <button
          onClick={reset}
          className="bg-[#F97316] hover:bg-[#EA580C] text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
        >
          Попробовать снова
        </button>
        {error.digest ? (
          <p className="text-gray-400 text-xs mt-6">Код ошибки: {error.digest}</p>
        ) : null}
      </div>
    </main>
  );
}
