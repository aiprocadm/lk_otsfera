'use client';

import React, { useState } from 'react';
import { resendInviteAction } from '@/server-actions/invite-resend';
import { toast } from '@/lib/ui/toast';

const ERROR_RU: Record<string, string> = {
  forbidden: 'Недостаточно прав',
  not_found: 'Пользователь не найден или деактивирован',
  already_active: 'Пользователь уже установил пароль',
  rate_limited: 'Слишком много отправок — попробуйте через час'
};

/**
 * Кнопки у не активировавшего приглашение участника (этап 4, ФТ-10.2):
 * «Отправить повторно» — новое письмо (старая ссылка перестаёт работать),
 * «Скопировать ссылку» — пере-выпуск ссылки без письма (запасной канал).
 * Строго презентационный + domain-agnostic (только userId) — сознательно
 * общий для org/partner/admin таблиц (§4 CLAUDE.md, исключение sibling-паттерна).
 */
export function InviteResendButtons({ userId }: { userId: string }) {
  const [busy, setBusy] = useState<'email' | 'copy' | null>(null);

  async function run(kind: 'email' | 'copy') {
    setBusy(kind);
    try {
      const res = await resendInviteAction({ userId, sendEmail: kind === 'email' });
      if (!res.ok) {
        toast.error(ERROR_RU[res.error] ?? 'Не удалось переотправить приглашение');
        return;
      }
      if (kind === 'copy') {
        try {
          await navigator.clipboard.writeText(res.inviteUrl);
          toast.success('Ссылка скопирована (прежняя ссылка больше не действует)');
        } catch {
          toast.error('Не удалось скопировать — выделите ссылку вручную: ' + res.inviteUrl);
        }
        return;
      }
      toast.success(
        res.emailStatus === 'sent'
          ? 'Письмо приглашения отправлено повторно'
          : 'Почта выключена — используйте «Скопировать ссылку»'
      );
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setBusy(null);
    }
  }

  return (
    <span className='inline-flex flex-wrap gap-x-2 gap-y-0.5'>
      <button
        type='button'
        onClick={() => run('email')}
        disabled={busy !== null}
        className='text-xs text-[#F97316] hover:underline disabled:text-gray-400'
      >
        {busy === 'email' ? 'Отправляем…' : 'Отправить повторно'}
      </button>
      <button
        type='button'
        onClick={() => run('copy')}
        disabled={busy !== null}
        className='text-xs text-[#F97316] hover:underline disabled:text-gray-400'
      >
        {busy === 'copy' ? 'Готовим…' : 'Скопировать ссылку'}
      </button>
    </span>
  );
}
