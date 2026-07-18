'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

const MIN_LENGTH = 8;

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_LENGTH) {
      toast.error(`Пароль должен быть не короче ${MIN_LENGTH} символов`);
      return;
    }
    if (password !== confirm) {
      toast.error('Пароли не совпадают');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/auth/reset-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (res.ok) {
        toast.success('Пароль установлен. Войдите в систему.');
        router.push('/login');
        return;
      }
      const body = await res.json().catch(() => null);
      if (body?.error === 'invalid_token') {
        toast.error('Ссылка недействительна или истекла. Запросите новую.');
      } else if (body?.error === 'weak_password') {
        toast.error(`Слабый пароль (минимум ${MIN_LENGTH} символов).`);
      } else if (res.status === 429) {
        toast.error('Слишком много попыток. Подождите немного и попробуйте снова.');
      } else {
        toast.error('Не удалось установить пароль. Попробуйте ещё раз.');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-4'>
      <div>
        <label className='block text-sm font-medium text-gray-700 mb-1.5'>
          Новый пароль
        </label>
        <input
          type='password'
          required
          minLength={MIN_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
          placeholder='••••••••'
          className='w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-60 transition-all'
          autoComplete='new-password'
        />
      </div>
      <div>
        <label className='block text-sm font-medium text-gray-700 mb-1.5'>
          Повторите пароль
        </label>
        <input
          type='password'
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={pending}
          placeholder='••••••••'
          className='w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-60 transition-all'
          autoComplete='new-password'
        />
      </div>
      <button
        type='submit'
        disabled={pending}
        className='w-full bg-[#F97316] hover:bg-[#EA580C] text-white font-semibold rounded-lg py-3 text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2'
      >
        {pending ? 'Сохраняем…' : 'Установить пароль'}
      </button>
    </form>
  );
}
