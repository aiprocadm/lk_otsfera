import React from 'react';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/ui';
import { requireAdmin } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { getUser } from '@/lib/services/admin/users';
import { listActivePartnerOptions } from '@/lib/services/admin/partners';
import { UserEditForm } from '@/components/admin/user-edit-form';
import { ManagerRoleControl } from '@/components/admin/manager-role-control';
import { AdminBackupCodesControl } from '@/components/admin/admin-backup-codes-control';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';

export const dynamic = 'force-dynamic';

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  const { id } = await params;
  const user = await getUser(prisma, session, id);
  if (!user) notFound();

  const partners = await listActivePartnerOptions(prisma);

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        {/* `У-72`: полный путь до экрана вместо одиночного «назад». */}
        <Breadcrumbs
          items={buildCabinetBreadcrumbs('admin', '/admin/users', [
            { label: user.name || user.email },
          ])}
        />
        <h1 className="text-2xl font-bold text-[#111111] mt-1">{user.name}</h1>
        <p className="text-sm text-gray-500">{user.email}</p>
      </div>
      <UserEditForm user={user} partners={partners} isSelf={session.sub === user.id} />
      {user.role === 'manager' && (
        <div className="rounded-lg border p-4 space-y-2">
          <h2 className="text-sm font-semibold text-[#111111]">Менеджерский кабинет</h2>
          <ManagerRoleControl userId={user.id} current={user.managerRole} />
        </div>
      )}
      {isFeatureEnabled('staff_2fa') && (user.role === 'admin' || user.role === 'manager') && (
        <AdminBackupCodesControl userId={user.id} />
      )}
    </div>
  );
}
