import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { LeadCreateForm } from '@/components/partner/lead-create-form';

export default async function PartnerLeadNewPage() {
  const session = await getSession();
  if (!session?.partnerId) redirect('/login');

  const where = session.assignedOrgIds && session.assignedOrgIds.length > 0
    ? { partnerId: session.partnerId, id: { in: session.assignedOrgIds } }
    : { partnerId: session.partnerId };

  const orgs = await prisma.organization.findMany({
    where,
    orderBy: { name: 'asc' },
    select: { id: true, name: true }
  });

  return (
    <div className='space-y-4 max-w-3xl'>
      <div className='text-sm'>
        <Link href='/partner/leads' className='text-gray-500 hover:text-[#F97316]'>
          ← Все заявки
        </Link>
      </div>

      <div>
        <h1 className='text-2xl font-bold text-[#111111]'>Новая заявка</h1>
        <p className='text-sm text-gray-500 mt-0.5'>
          Опишите запрос — менеджер Промтехносферы возьмёт его в работу
        </p>
      </div>

      <LeadCreateForm orgs={orgs} />
    </div>
  );
}
