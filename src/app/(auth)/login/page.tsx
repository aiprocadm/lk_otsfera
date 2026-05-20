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
    <main className='min-h-screen grid place-items-center p-6 bg-slate-50'>
      <form onSubmit={onSubmit} className='w-full max-w-sm space-y-4 border rounded-xl p-6 bg-white shadow-sm'>
        <h1 className='text-2xl font-semibold'>Вход</h1>
        {error && (
          <div className='text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2'>
            {error}
          </div>
        )}
        <input
          className='w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-zinc-400'
          placeholder='Email'
          type='email'
          autoComplete='email'
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          required
        />
        <input
          type='password'
          className='w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-zinc-400'
          placeholder='Пароль'
          autoComplete='current-password'
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          required
        />
        <button
          type='submit'
          disabled={loading}
          className='w-full bg-zinc-900 text-white rounded p-2 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity'
        >
          {loading ? 'Входим...' : 'Войти'}
        </button>
      </form>
    </main>
  );
}
