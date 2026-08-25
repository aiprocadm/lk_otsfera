import React from 'react';
import { Breadcrumbs } from '@/components/ui';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listActivePartnerOptions } from '@/lib/services/admin/partners';
import { listCompanyOptions } from '@/lib/services/admin/orders';
import { UserInviteForm } from '@/components/admin/user-invite-form';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

export default async function NewUserPage() {
  await requireAdmin();
  const [partners, companies] = await Promise.all([
    listActivePartnerOptions(prisma),
    listCompanyOptions(prisma),
  ]);

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        {/* `У-72`: полный путь до экрана вместо одиночного «назад». */}
        <Breadcrumbs
          items={buildCabinetBreadcrumbs('admin', '/admin/users', [
            { label: 'Новый пользователь' },
          ])}
        />
        <PageHeader
          title="Пригласить пользователя"
          subtitle="Заведите человека и дайте ему доступ в нужный кабинет"
        />
      </div>
      <UserInviteForm partners={partners} companies={companies} />
    </div>
  );
}
