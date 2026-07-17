import React from 'react';
import { notFound } from 'next/navigation';
import { BackLink, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getOrganization } from '@/lib/services/admin/organizations';
import { listOrgRateHistory } from '@/lib/services/commission/rateHistory';
import { CustomerAccessSection } from '@/components/partner/customer-access-section';
import { ManagersBlock } from '@/components/admin/managers-block';
import { OrganizationEditForm } from '@/components/admin/organization-edit-form';
import { AdminRateOverrideForm } from '@/components/admin/admin-rate-override-form';
import { fmtDate } from '@/lib/format';

const fmtRate = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 2 });

export const dynamic = 'force-dynamic';

export default async function AdminOrganizationDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;

  const [org, meta, rateHistoryResult] = await Promise.all([
    getOrganization(prisma, id),
    prisma.organization.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true } },
        _count: { select: { orders: true, students: true, organizationUsers: true } }
      }
    }),
    listOrgRateHistory(prisma, session, id)
  ]);
  if (!org || !meta) notFound();
  const rateHistory = rateHistoryResult.ok ? rateHistoryResult.rows : [];

  return (
    <div className='space-y-5'>
      <div>
        <BackLink href='/admin/organizations' label='Все организации' />
        <h1 className='text-2xl font-bold text-[#111111] mt-1'>{org.name}</h1>
        <p className='text-sm text-gray-500 mt-0.5'>
          Партнёр: {org.partner?.name ?? 'Без партнёра'}
          {meta.company && <span> · Компания: {meta.company.name}</span>}
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
            {meta._count.orders} заказов · {meta._count.students} сотрудников ·{' '}
            {meta._count.organizationUsers} в кабинете
          </div>
        </div>
      </div>

      <section className='space-y-3'>
        <h2 className='text-base font-semibold text-[#111111]'>Реквизиты</h2>
        <OrganizationEditForm org={org} />
      </section>

      <section className='space-y-3'>
        <h2 className='text-base font-semibold text-[#111111]'>Ставка комиссии</h2>
        <p className='text-sm text-gray-500'>
          Базовая ставка партнёра действует, если переопределение не задано.
        </p>
        <AdminRateOverrideForm
          organizationId={org.id}
          initialRate={org.partnerCommissionRate}
          initialNote={org.partnerCommissionRateNote}
        />
      </section>

      <section className='space-y-3'>
        <h2 className='text-base font-semibold text-[#111111]'>История ставок</h2>
        {rateHistory.length === 0 ? (
          <p className='text-sm text-gray-500'>Изменений не было.</p>
        ) : (
          <TableShell>
            <THead className='bg-[#F3F4F6]'>
              <Th className='py-2 text-[#111111]'>Дата</Th>
              <Th className='py-2 text-[#111111]'>Было</Th>
              <Th className='py-2 text-[#111111]'>Стало</Th>
              <Th className='py-2 text-[#111111]'>Кто</Th>
            </THead>
            <tbody>
              {rateHistory.map((row) => (
                <Tr key={row.id} hover={false} className='border-gray-100'>
                  <Td className='py-2 text-gray-700'>{fmtDate(row.effectiveFrom)}</Td>
                  <Td className='py-2 text-gray-700'>
                    {row.oldRate !== null ? fmtRate.format(row.oldRate) : '—'}
                  </Td>
                  <Td className='py-2 text-gray-700'>
                    {row.newRate !== null ? fmtRate.format(row.newRate) : 'сброс (ставка партнёра)'}
                  </Td>
                  <Td className='py-2 text-gray-500'>{row.changedByName ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </section>

      <CustomerAccessSection organizationId={org.id} canInvite={true} source='admin' />

      <ManagersBlock orgId={org.id} />
    </div>
  );
}
