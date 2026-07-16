'use client';

import React, { useState, useTransition } from 'react';

/**
 * Форма самостоятельного запроса сброса пароля (`/reset-password` без токена).
 *
 * Анти-enumeration: бэкенд (`/api/auth/reset-password/request`) всегда отвечает
 * `{ ok: true }` независимо от существования email, поэтому и success-текст
 * здесь один для всех — форма не раскрывает, зарегистрирован ли адрес.
 * Ошибки — inline (не sonner): 429 от rate-limiter'а и generic для остального.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    startTransition(async () => {
      try {
        const res = await fetch('/api/auth/reset-password/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (res.ok) {
          setSent(true);
        } else if (res.status === 429) {
          setError('Слишком много запросов, попробуйте позже');
        } else {
          setError('Не удалось отправить запрос, попробуйте позже');
        }
      } catch {
        setError('Не удалось отправить запрос, попробуйте позже');
      }
    });
  }

  if (sent) {
    return (
      <p role='status' className='text-sm text-gray-600'>
        Если такой email зарегистрирован, мы отправили письмо со ссылкой для сброса пароля.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-4'>
      {error && (
        <div className='flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3'>
          <span className='mt-0.5'>⚠</span>
          <span>{error}</span>
        </div>
      )}
      <div>
        <label htmlFor='forgot-password-email' className='block text-sm font-medium text-gray-700 mb-1.5'>
          Email
        </label>
        <input
          id='forgot-password-email'
          type='email'
          required
          autoComplete='email'
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
          placeholder='user@company.ru'
          className='w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-60 transition-all'
        />
      </div>
      <button
        type='submit'
        disabled={pending}
        className='w-full bg-[#F97316] hover:bg-[#EA580C] text-white font-semibold rounded-lg py-3 text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2'
      >
        {pending ? 'Отправляем…' : 'Отправить ссылку'}
      </button>
    </form>
  );
}
