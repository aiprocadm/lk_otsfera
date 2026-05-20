import Link from 'next/link';

export default function NotFound() {
  return (
    <main className='min-h-screen grid place-items-center p-6 bg-slate-50'>
      <div className='text-center space-y-4'>
        <h1 className='text-2xl font-semibold'>404 — Страница не найдена</h1>
        <p className='text-slate-500 text-sm'>Запрашиваемая страница не существует.</p>
        <Link
          href='/dashboard'
          className='inline-block bg-zinc-900 text-white px-4 py-2 rounded text-sm hover:bg-zinc-700 transition-colors'
        >
          На главную
        </Link>
      </div>
    </main>
  );
}
