import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { CustomerAccessSection } from '@/components/partner/customer-access-section';
import { ManagersBlock } from '@/components/admin/managers-block';

export const dynamic = 'force-dynamic';

export default async function AdminOrganizationDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      partner: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      _count: { select: { orders: true, students: true, organizationUsers: true } }
    }
  });
  if (!org) notFound();

  return (
    <div className='space-y-5'>
      <div>
        <Link
          href='/admin/organizations'
          className='text-xs text-gray-500 hover:text-[#F97316]'
        >
          ← Все организации
        </Link>
        <h1 className='text-2xl font-bold text-[#111111] mt-1'>{org.name}</h1>
        <p className='text-sm text-gray-500 mt-0.5'>
          Партнёр: {org.partner.name}
          {org.company && <span> · Компания: {org.company.name}</span>}
        </p>
      </div>

      <div className='grid gap-3 md:grid-cols-3'>
        <div className='bg-white border border-gray-200 rounded-xl p-4'>
          <div className='text-xs text-gray-500'>ИНН / КПП</div>
          <div className='text-sm font-mono text-[#111111] mt-1'>
            {org.inn ?? '—'}
            {org.kpp && <span className='text-gray-400'> / {org.kpp}</span>}
          </div>
        </div>
        <div className='bg-white border border-gray-200 rounded-xl p-4'>
          <div className='text-xs text-gray-500'>1С ID</div>
          <div className='text-sm font-mono text-[#111111] mt-1'>
            {org.externalId ?? '—'}
          </div>
        </div>
        <div className='bg-white border border-gray-200 rounded-xl p-4'>
          <div className='text-xs text-gray-500'>Объёмы</div>
          <div className='text-sm text-[#111111] mt-1'>
            {org._count.orders} заказов · {org._count.students} сотрудников ·{' '}
            {org._count.organizationUsers} в кабинете
          </div>
        </div>
      </div>

      <CustomerAccessSection organizationId={org.id} canInvite={true} source='admin' />

      <ManagersBlock orgId={org.id} />
    </div>
  );
}
