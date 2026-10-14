'use client';

import React, { useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { issueLoginLinkAction } from '@/server-actions/admin/users';
import type { EmailOutcome } from '@/lib/email/outcome';

const ERROR_LABELS: Record<string, string> = {
  inactive: 'Пользователь отключён — сначала включите его, потом создайте ссылку.',
  not_found: 'Пользователь не найден — обновите страницу.',
  forbidden: 'Ссылку входа создаёт только администратор.',
};

export type LoginEmailAttemptView = {
  /** ISO-строка: дата через границу server→client. */
  at: string;
  kind: 'invite' | 'login_link';
  outcome: EmailOutcome;
};

function outcomeText(o: EmailOutcome): string {
  return o.status === 'sent' ? 'письмо отправлено' : `письмо не отправлено: ${o.reason}`;
}

/**
 * «Вход в кабинет» в карточке пользователя (`У-271`, `У-272`, ТЗ 13.10.2026):
 * последняя попытка письма со ссылкой входа и кнопка «Создать ссылку входа» —
 * для того, кто потерял доступ. Ссылка показывается сразу: если письмо не
 * ушло, администратор передаёт её сам.
 */
export function AdminLoginLinkPanel({
  userId,
  isActive,
  lastAttempt,
}: {
  userId: string;
  isActive: boolean;
  lastAttempt: LoginEmailAttemptView | null;
}) {
  const [pending, startTransition] = useTransition();
  const [issued, setIssued] = useState<{ url: string; email: EmailOutcome } | null>(null);

  function issue() {
    startTransition(async () => {
      const res = await issueLoginLinkAction({ userId });
      if (!res.ok) {
        toast.error(resolveErrorText(res.error, ERROR_LABELS));
        return;
      }
      setIssued({ url: res.url, email: res.email });
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
      <div>
        <h2 className="text-base font-semibold text-[#111111]">Вход в кабинет</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Если человек не может войти или потерял доступ, создайте одноразовую ссылку: по ней он
          задаст новый пароль.
        </p>
      </div>
      {lastAttempt ? (
        <p className="text-sm text-gray-700" data-testid="last-login-email">
          {lastAttempt.kind === 'invite' ? 'Приглашение' : 'Ссылка входа'} от{' '}
          {new Date(lastAttempt.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}:{' '}
          <span
            className={
              lastAttempt.outcome.status === 'sent'
                ? 'text-green-700'
                : 'font-medium text-amber-700'
            }
          >
            {outcomeText(lastAttempt.outcome)}
          </span>
        </p>
      ) : (
        <p className="text-sm text-gray-500">Ссылок входа этому пользователю ещё не отправляли.</p>
      )}
      {issued ? (
        <div
          role="status"
          className={
            issued.email.status === 'sent'
              ? 'space-y-2 rounded bg-green-50 px-3 py-2 text-sm text-green-700'
              : 'space-y-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800'
          }
        >
          <p>
            Ссылка создана, {outcomeText(issued.email)}.
            {issued.email.status === 'sent' ? ' Если письмо не дошло,' : ' Передайте её сами —'}{' '}
            скопируйте ссылку:
          </p>
          <input
            type="text"
            readOnly
            aria-label="Ссылка входа"
            value={issued.url}
            onFocus={(e) => e.target.select()}
            className="w-full rounded border border-gray-200 px-2 py-1 font-mono text-xs"
          />
        </div>
      ) : (
        <Button onClick={issue} disabled={!isActive || pending} loading={pending}>
          Создать ссылку входа
        </Button>
      )}
      {!isActive && (
        <p className="text-xs text-gray-500">
          Пользователь отключён — ссылка входа ему не поможет, пока его не включат.
        </p>
      )}
    </section>
  );
}
