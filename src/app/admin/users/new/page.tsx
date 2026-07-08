import React from 'react';
import { BackLink } from '@/components/ui';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { UserInviteForm } from '@/components/admin/user-invite-form';

export const dynamic = 'force-dynamic';

export default async function NewUserPage() {
  await requireAdmin();
  const partners = await prisma.partner.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <BackLink href='/admin/users' label='Все пользователи' />
        <h1 className="text-2xl font-bold text-[#111111] mt-1">Пригласить пользователя</h1>
      </div>
      <UserInviteForm partners={partners} />
    </div>
  );
}
