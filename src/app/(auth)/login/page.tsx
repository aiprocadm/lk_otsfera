'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (res.ok) {
        router.push('/dashboard');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? 'Неверный email или пароль');
      }
    } catch {
      setError('Ошибка сети. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className='min-h-screen flex'>
      {/* Left panel — brand */}
      <div className='hidden lg:flex flex-col justify-between w-1/2 bg-[#111111] p-12 text-white'>
        <div className='flex items-center gap-3'>
          <span className='w-10 h-10 rounded-lg bg-[#F97316] flex items-center justify-center font-black text-white text-lg'>О</span>
          <span className='font-bold text-lg tracking-widest uppercase'>ОТСФЕРА</span>
        </div>
        <div className='space-y-4'>
          <h1 className='text-4xl font-bold leading-tight'>
            Личный кабинет<br />
            <span className='text-[#F97316]'>B2B платформы</span>
          </h1>
          <p className='text-gray-400 text-lg'>Управление заказами, документами и командой в одном месте.</p>
        </div>
        <div className='text-gray-600 text-sm'>© 2024 ОТСФЕРА. Все права защищены.</div>
      </div>

      {/* Right panel — form */}
      <div className='flex-1 flex items-center justify-center p-8 bg-gray-50'>
        <div className='w-full max-w-md'>
          {/* Mobile logo */}
          <div className='flex items-center gap-2 mb-8 lg:hidden'>
            <span className='w-8 h-8 rounded-md bg-[#F97316] flex items-center justify-center font-black text-white text-sm'>О</span>
            <span className='font-bold tracking-widest uppercase text-[#111111]'>ОТСФЕРА</span>
          </div>

          <div className='bg-white rounded-2xl shadow-xl border border-gray-100 p-8'>
            <h2 className='text-2xl font-bold text-[#111111] mb-1'>Вход в систему</h2>
            <p className='text-gray-500 text-sm mb-6'>Введите данные вашего аккаунта</p>

            {error && (
              <div className='mb-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3'>
                <span className='mt-0.5'>⚠</span>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={onSubmit} className='space-y-4'>
              <div>
                <label className='block text-sm font-medium text-gray-700 mb-1.5'>Email</label>
                <input
                  type='email'
                  autoComplete='email'
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  placeholder='admin@company.ru'
                  className='w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-60 transition-all'
                />
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-700 mb-1.5'>Пароль</label>
                <input
                  type='password'
                  autoComplete='current-password'
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  placeholder='••••••••'
                  className='w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-60 transition-all'
                />
              </div>
              <button
                type='submit'
                disabled={loading}
                className='w-full bg-[#F97316] hover:bg-[#EA580C] text-white font-semibold rounded-lg py-3 text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2'
              >
                {loading ? 'Входим...' : 'Войти'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
