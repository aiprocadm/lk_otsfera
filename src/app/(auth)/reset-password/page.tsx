import Link from 'next/link';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

type SearchParams = Promise<{ token?: string }>;

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <main className='min-h-screen flex items-center justify-center px-4 bg-gray-50'>
        <div className='w-full max-w-md bg-white border border-gray-100 rounded-2xl shadow-xl p-8 space-y-4'>
          <h1 className='text-2xl font-bold text-[#111111]'>Ссылка недействительна</h1>
          <p className='text-sm text-gray-600'>
            Запросите новое приглашение у администратора или используйте ссылку из исходного письма.
          </p>
          <Link href='/login' className='inline-block text-sm text-[#F97316] hover:underline'>
            ← Вернуться на страницу входа
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className='min-h-screen flex items-center justify-center px-4 bg-gray-50'>
      <div className='w-full max-w-md bg-white border border-gray-100 rounded-2xl shadow-xl p-8 space-y-5'>
        <div>
          <h1 className='text-2xl font-bold text-[#111111]'>Установка пароля</h1>
          <p className='text-sm text-gray-500 mt-0.5'>Создайте новый пароль для входа в кабинет.</p>
        </div>
        <ResetPasswordForm token={token} />
      </div>
    </main>
  );
}
