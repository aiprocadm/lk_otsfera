import Link from 'next/link';

export default function NotFound() {
  return (
    <main className='min-h-screen flex items-center justify-center bg-gray-50 p-6'>
      <div className='text-center max-w-md'>
        <div className='text-8xl font-black text-[#F97316] mb-4'>404</div>
        <h1 className='text-2xl font-bold text-[#111111] mb-2'>Страница не найдена</h1>
        <p className='text-gray-500 mb-6'>Запрашиваемая страница не существует или была удалена.</p>
        <Link
          href='/dashboard'
          className='inline-block bg-[#111111] hover:bg-[#F97316] text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors'
        >
          На главную
        </Link>
      </div>
    </main>
  );
}
