'use client';
import { useEffect } from 'react';
import { Button } from '@/components/ui';
import { clientLog } from '@/lib/logging/client';

// Сегментный error-boundary: ошибка страницы показывается внутри layout
// кабинета (навигация остаётся живой), в отличие от корневого app/error.tsx.
export default function CabinetError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    clientLog.error(error);
  }, [error]);

  return (
    <div className='flex items-center justify-center py-24'>
      <div className='text-center max-w-md'>
        <div className='w-16 h-16 bg-brand-orange rounded-2xl flex items-center justify-center mx-auto mb-6'>
          <span className='text-white text-2xl font-bold'>!</span>
        </div>
        <h1 className='text-2xl font-bold text-brand-black mb-2'>Что-то пошло не так</h1>
        <p className='text-gray-500 mb-6'>Произошла непредвиденная ошибка. Попробуйте ещё раз.</p>
        <Button onClick={reset}>Попробовать снова</Button>
      </div>
    </div>
  );
}
