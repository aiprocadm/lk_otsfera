'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessageRu } from '@/lib/errors/messages';

export type DemoLogin = { label: string; email: string; password: string };

export function LoginForm({ demoLogins }: { demoLogins?: DemoLogin[] }) {
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
        const data: unknown = await res.json().catch(() => ({}));
        const code = typeof (data as { code?: unknown })?.code === 'string' ? (data as { code: string }).code : '';
        setError(errorMessageRu(code.toLowerCase(), 'Неверный email или пароль.'));
      }
    } catch {
      setError('Ошибка сети. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }

  return (
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

      {demoLogins && demoLogins.length > 0 && (
        <div className='mt-6 pt-6 border-t border-gray-100'>
          <div className='flex items-center gap-2 mb-1'>
            <h3 className='text-sm font-semibold text-[#111111]'>Демо-доступ</h3>
            <span className='text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5'>
              только для тестовых стендов
            </span>
          </div>
          <p className='text-xs text-gray-500 mb-3'>
            Нажмите на роль, чтобы подставить данные в форму, затем «Войти».
          </p>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
            {demoLogins.map((d) => (
              <button
                key={d.email}
                type='button'
                onClick={() => {
                  setEmail(d.email);
                  setPassword(d.password);
                  setError('');
                }}
                disabled={loading}
                className='text-left border border-gray-200 rounded-lg px-3 py-2 hover:border-[#F97316] hover:bg-[#FFF7ED] transition-colors disabled:opacity-60'
              >
                <div className='text-sm font-medium text-[#111111]'>{d.label}</div>
                <div className='text-xs text-gray-500 font-mono mt-0.5 break-all'>{d.email}</div>
                <div className='text-xs text-gray-400 font-mono break-all'>пароль: {d.password}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
