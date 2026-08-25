import React from 'react';
import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { peekTokenPurpose } from '@/lib/auth/passwordReset';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

import { PageHeader } from '@/components/ui/page-header';
type SearchParams = Promise<{ token?: string }>;

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
        <div className="w-full max-w-md bg-white border border-gray-100 rounded-2xl shadow-xl p-8 space-y-5">
          <div>
            <PageHeader
              title="Восстановление пароля"
              subtitle="Укажите email вашего аккаунта — мы отправим ссылку для сброса пароля."
            />
          </div>
          <ForgotPasswordForm />
          <Link href="/login" className="inline-block text-sm text-[#F97316] hover:underline">
            ← Вернуться на страницу входа
          </Link>
        </div>
      </main>
    );
  }

  // ФТ-10.3 (этап 4): приглашённый и восстанавливающий пароль видят разные
  // формулировки. Токен здесь только читается (peek) — гасит его confirm-роут.
  const peek = await peekTokenPurpose(prisma, token);
  const isInvite = peek.valid && peek.purpose === 'invite';

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
      <div className="w-full max-w-md bg-white border border-gray-100 rounded-2xl shadow-xl p-8 space-y-5">
        <div>
          <PageHeader
            title={isInvite ? 'Добро пожаловать!' : 'Установка пароля'}
            subtitle={
              isInvite
                ? 'Аккаунт создан для вас — осталось придумать пароль, и можно начинать работу.'
                : 'Создайте новый пароль для входа в кабинет.'
            }
          />
        </div>
        <ResetPasswordForm token={token} />
      </div>
    </main>
  );
}
