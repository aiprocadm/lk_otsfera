'use client';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessageRu } from '@/lib/errors/messages';

export type DemoLogin = { label: string; email: string; password: string };

const RESEND_COOLDOWN_SEC = 30;

const inputCls =
  'w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-60 transition-all';

export function LoginForm({ demoLogins }: { demoLogins?: DemoLogin[] }) {
  const [step, setStep] = useState<'credentials' | 'code'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const router = useRouter();

  // Секундный тик кулдауна переотправки (шаг 2FA). Пересоздание интервала на
  // каждый тик — сознательная простота: тикает максимум 30 секунд.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

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
        // try/catch, а не .catch(): переживает и отсутствие тела, и мок без json()
        let data: unknown = {};
        try {
          data = await res.json();
        } catch {
          data = {};
        }
        if ((data as { twoFactorRequired?: unknown })?.twoFactorRequired === true) {
          // Staff 2FA: пароль верен, сессии ещё нет — шаг ввода кода из письма
          setStep('code');
          setCode('');
          setNotice('Мы отправили код на вашу почту.');
          setResendCooldown(RESEND_COOLDOWN_SEC);
          return;
        }
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

  async function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });

      if (res.ok) {
        router.push('/dashboard');
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        const apiCode = typeof (data as { code?: unknown })?.code === 'string' ? (data as { code: string }).code : '';
        setError(errorMessageRu(apiCode.toLowerCase(), 'Неверный код.'));
      }
    } catch {
      setError('Ошибка сети. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/2fa/resend', { method: 'POST' });
      if (res.ok) {
        setNotice('Код отправлен повторно.');
        setResendCooldown(RESEND_COOLDOWN_SEC);
      } else {
        const data: unknown = await res.json().catch(() => ({}));
        const apiCode = typeof (data as { code?: unknown })?.code === 'string' ? (data as { code: string }).code : '';
        setError(errorMessageRu(apiCode.toLowerCase(), 'Не удалось отправить код.'));
      }
    } catch {
      setError('Ошибка сети. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }

  function backToCredentials() {
    setStep('credentials');
    setCode('');
    setError('');
    setNotice('');
  }

  return (
    <div className='bg-white rounded-2xl shadow-xl border border-gray-100 p-8'>
      <h2 className='text-2xl font-bold text-[#111111] mb-1'>Вход в систему</h2>
      <p className='text-gray-500 text-sm mb-6'>
        {step === 'credentials' ? 'Введите данные вашего аккаунта' : 'Введите код из письма'}
      </p>

      {error && (
        <div className='mb-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3'>
          <span className='mt-0.5'>⚠</span>
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div className='mb-4 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3' role='status'>
          {notice}
        </div>
      )}

      {step === 'credentials' ? (
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
              className={inputCls}
            />
          </div>
          <div>
            <div className='flex items-center justify-between mb-1.5'>
              <label className='block text-sm font-medium text-gray-700'>Пароль</label>
              <a
                href='/reset-password'
                className='text-sm text-[#F97316] hover:text-[#EA580C] transition-colors'
              >
                Забыли пароль?
              </a>
            </div>
            <input
              type='password'
              autoComplete='current-password'
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder='••••••••'
              className={inputCls}
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
      ) : (
        <form onSubmit={onSubmitCode} className='space-y-4'>
          <div>
            <label className='block text-sm font-medium text-gray-700 mb-1.5'>Код подтверждения</label>
            <input
              type='text'
              inputMode='numeric'
              autoComplete='one-time-code'
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={loading}
              placeholder='Код из письма или код восстановления'
              className={inputCls}
            />
            <p className='text-xs text-gray-500 mt-1.5'>
              Нет доступа к почте? Введите один из кодов восстановления.
            </p>
          </div>
          <button
            type='submit'
            disabled={loading}
            className='w-full bg-[#F97316] hover:bg-[#EA580C] text-white font-semibold rounded-lg py-3 text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2'
          >
            {loading ? 'Проверяем...' : 'Подтвердить'}
          </button>
          <div className='flex items-center justify-between text-sm'>
            <button
              type='button'
              onClick={onResend}
              disabled={loading || resendCooldown > 0}
              className='text-[#F97316] hover:text-[#EA580C] disabled:text-gray-400 disabled:cursor-not-allowed transition-colors'
            >
              {resendCooldown > 0 ? `Отправить ещё раз (${resendCooldown}с)` : 'Отправить код ещё раз'}
            </button>
            <button
              type='button'
              onClick={backToCredentials}
              disabled={loading}
              className='text-gray-500 hover:text-gray-700 transition-colors'
            >
              Назад
            </button>
          </div>
        </form>
      )}

      {step === 'credentials' && demoLogins && demoLogins.length > 0 && (
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
