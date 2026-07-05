import React from 'react';
import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main className='min-h-screen flex items-center justify-center bg-gray-50 p-6'>
      <div className='text-center max-w-md'>
        <div className='text-8xl font-black text-[#111111] mb-4'>403</div>
        <h1 className='text-2xl font-bold text-[#111111] mb-2'>Доступ запрещён</h1>
        <p className='text-gray-500 mb-6'>У вас недостаточно прав для просмотра этого раздела.</p>
        {/* /dashboard — виртуальный алиас: middleware редиректит его на
            roleHome[role] (src/middleware.ts). Реальной страницы нет — не «чинить». */}
        <Link
          href='/dashboard'
          className='inline-block bg-[#F97316] hover:bg-[#EA580C] text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors'
        >
          Вернуться назад
        </Link>
      </div>
    </main>
  );
}
