import Link from 'next/link';
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
        <Link href="/admin/users" className="text-xs text-gray-500 hover:text-[#F97316]">
          ← К списку
        </Link>
        <h1 className="text-2xl font-bold text-[#111111] mt-1">Пригласить пользователя</h1>
      </div>
      <UserInviteForm partners={partners} />
    </div>
  );
}
