import React from 'react';
import { Breadcrumbs } from '@/components/ui';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listActivePartnerOptions } from '@/lib/services/admin/partners';
import { UserInviteForm } from '@/components/admin/user-invite-form';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';

export const dynamic = 'force-dynamic';

export default async function NewUserPage() {
  await requireAdmin();
  const partners = await listActivePartnerOptions(prisma);

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        {/* `У-72`: полный путь до экрана вместо одиночного «назад». */}
        <Breadcrumbs
          items={buildCabinetBreadcrumbs('admin', '/admin/users', [
            { label: 'Новый пользователь' },
          ])}
        />
        <h1 className="text-2xl font-bold text-[#111111] mt-1">Пригласить пользователя</h1>
        {/* `У-73`: одна строка «что здесь делают». */}
        <p className="text-sm text-gray-500 mt-0.5">
          Заведите человека и дайте ему доступ в нужный кабинет
        </p>
      </div>
      <UserInviteForm partners={partners} />
    </div>
  );
}
