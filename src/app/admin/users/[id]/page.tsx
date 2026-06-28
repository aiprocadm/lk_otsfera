import { notFound } from 'next/navigation';
import { BackLink } from '@/components/ui';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getUser } from '@/lib/services/admin/users';
import { UserEditForm } from '@/components/admin/user-edit-form';
import { ManagerRoleControl } from '@/components/admin/manager-role-control';

export const dynamic = 'force-dynamic';

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  const { id } = await params;
  const user = await getUser(prisma, id);
  if (!user) notFound();

  const partners = await prisma.partner.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  });

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <BackLink href='/admin/users' label='Все пользователи' />
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
    </div>
  );
}
