import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getManagerLead } from '@/lib/services/manager/leads';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { LeadStatusBadge } from '@/components/partner/lead-status-badge';
import { ManagerLeadActions } from '@/components/manager/manager-lead-actions';
import { PushLeadButton } from '@/components/manager/push-lead-button';
import { fmtDate, fmtMoney } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ManagerLeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireManager();
  const { id } = await params;
  const lead = await getManagerLead(prisma, session, id);
  if (!lead) notFound();

  const candidates = session.companyId
    ? (await listCompanyManagers(prisma, session.companyId))
        .filter((m) => m.isActive && m.id !== session.sub)
        .map((m) => ({ id: m.id, name: m.name, email: m.email }))
    : [];

  const rows: Array<[string, string]> = [
    ['Партнёр', lead.partnerName ?? '— (без партнёра)'],
    ['Организация', lead.organizationName ?? '— (не привязана)'],
    ['Контакт', lead.clientContactName],
    ['Телефон', lead.clientContactPhone ?? '—'],
    ['Email', lead.clientContactEmail ?? '—'],
    ['ИНН клиента', lead.clientInn ?? '—'],
    ['Оценка суммы', lead.estimatedAmount ? fmtMoney(lead.estimatedAmount) : '—'],
    ['Продукты', lead.productType.length ? lead.productType.join(', ') : '—'],
    ['Назначен', lead.assignedManagerName ?? '—'],
    ['Создал', lead.createdByUserName],
    [
      '1С',
      lead.pushedToOneCAt
        ? `отправлено ${fmtDate(lead.pushedToOneCAt)}, №${lead.externalIdInOneC ?? '—'}`
        : 'не отправлялся'
    ]
  ];

  return (
    <div className='space-y-5'>
      <div>
        <Link href='/manager/leads' className='text-sm text-gray-500 hover:text-[#F97316]'>← Все заявки</Link>
        <div className='mt-1 flex items-center gap-3'>
          <h1 className='text-2xl font-semibold text-[#111111]'>{lead.clientCompanyName}</h1>
          <LeadStatusBadge status={lead.status} />
        </div>
        <p className='text-sm text-gray-600 mt-0.5'>{lead.subject}</p>
      </div>

      <div className='rounded-xl border border-gray-200 p-4'>
        <h2 className='text-sm font-semibold text-[#111111] mb-2'>Действия</h2>
        <ManagerLeadActions
          leadId={lead.id}
          status={lead.status}
          hasOrganization={lead.organizationId !== null}
          promotedOrderId={lead.promotedOrderId}
          candidates={candidates}
        />
        {/* B3: отправлять можно лид в любом статусе (ручная кнопка, решение владельца);
            скрываем только уже отправленный. */}
        {lead.pushedToOneCAt === null && (
          <div className='mt-3'>
            <PushLeadButton leadId={lead.id} />
          </div>
        )}
        {lead.organizationId === null && lead.status !== 'promoted_to_order' && lead.status !== 'rejected' && (
          <p className='text-xs text-gray-500 mt-2'>
            Чтобы преобразовать заявку в заказ, к ней должна быть привязана организация.
          </p>
        )}
        {lead.rejectedReason && (
          <p className='text-sm text-gray-600 mt-2'>Причина отклонения: {lead.rejectedReason}</p>
        )}
      </div>

      <dl className='rounded-xl border border-gray-200 divide-y divide-gray-100'>
        {rows.map(([k, v]) => (
          <div key={k} className='flex px-4 py-2.5 text-sm'>
            <dt className='w-44 shrink-0 text-gray-500'>{k}</dt>
            <dd className='text-[#111111]'>{v}</dd>
          </div>
        ))}
      </dl>

      {lead.notes && (
        <div className='rounded-xl border border-gray-200 p-4'>
          <h2 className='text-sm font-semibold text-[#111111] mb-1'>Примечания</h2>
          <p className='text-sm text-gray-700 whitespace-pre-wrap'>{lead.notes}</p>
        </div>
      )}
    </div>
  );
}