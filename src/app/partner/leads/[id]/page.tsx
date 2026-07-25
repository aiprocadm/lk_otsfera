import React from 'react';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { BackLink } from '@/components/ui';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { requirePartner } from '@/lib/auth/requireRole';
import { getLead } from '@/lib/services/partner/leads';
import { listLeadAttachments } from '@/lib/services/partner/leadAttachments';
import { isPartnerAdmin } from '@/lib/auth/policy';
import { LeadStatusBadge } from '@/components/partner/lead-status-badge';
import { LeadWithdrawButton } from '@/components/partner/lead-withdraw-button';
import { LeadAttachmentDropzone } from '@/components/partner/lead-attachment-dropzone';
import { LeadAttachmentsList } from '@/components/partner/lead-attachments-list';

function fmtMoney(s: string | null): string {
  if (!s) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(d);
}

const PRODUCT_LABEL: Record<string, string> = {
  training: 'Обучение',
  service: 'Услуги',
  supply: 'Поставка'
};

export default async function PartnerLeadDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  // ФТ-1.7: при включённых обращениях клиентов партнёрские лиды закрыты.
  if (isFeatureEnabled('client_requests')) redirect('/partner/requests');
  const session = await requirePartner();

  const { id } = await params;
  const scope = session.assignedOrgIds && session.assignedOrgIds.length > 0
    ? session.assignedOrgIds
    : undefined;

  const lead = await getLead(prisma, { leadId: id, partnerId: session.partnerId, scopeOrgIds: scope });
  if (!lead) notFound();

  const attachmentsResult = await listLeadAttachments(prisma, {
    leadId: id,
    partnerId: session.partnerId,
    scopeOrgIds: scope
  });
  const attachments = attachmentsResult.ok ? attachmentsResult.rows : [];

  const canWithdraw = lead.status === 'new' || lead.status === 'in_review';
  const canEditAttachments = canWithdraw;
  const partnerAdmin = isPartnerAdmin(session);

  return (
    <div className='space-y-4 max-w-3xl'>
      <div className='text-sm'>
        <BackLink href='/partner/leads' label='Все заявки' />
      </div>

      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2 flex-wrap'>
            <h1 className='text-2xl font-bold text-[#111111]'>{lead.clientCompanyName}</h1>
            <LeadStatusBadge status={lead.status} />
          </div>
          <p className='text-sm text-gray-500 mt-0.5'>{lead.subject}</p>
        </div>
        <div className='flex gap-2'>
          {canWithdraw && <LeadWithdrawButton leadId={lead.id} />}
        </div>
      </div>

      {lead.promotedOrderId && (
        <div className='bg-[#FFF7ED] border border-[#FED7AA] rounded-xl p-4 flex items-start justify-between gap-3'>
          <div className='text-sm'>
            <div className='font-medium text-[#9A3412]'>Заявка стала заказом</div>
            <div className='text-[#9A3412]/80 mt-0.5'>Можно отслеживать ход исполнения в разделе «Заказы».</div>
          </div>
          <Link
            href={`/partner/deals/${lead.promotedOrderId}`}
            className='shrink-0 px-3 py-1.5 text-sm bg-[#F97316] text-white rounded-lg hover:bg-[#EA580C]'
          >
            Открыть заказ
          </Link>
        </div>
      )}

      {lead.rejectedReason && (
        <div className='bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm'>
          <div className='font-medium text-gray-700'>Причина отклонения</div>
          <div className='text-gray-600 mt-1 whitespace-pre-wrap'>{lead.rejectedReason}</div>
        </div>
      )}

      <div className='grid gap-4 md:grid-cols-3'>
        <div className='md:col-span-2 space-y-4'>
          <Card title='Клиент'>
            <Field label='Название'>{lead.clientCompanyName}</Field>
            {lead.clientInn && <Field label='ИНН'>{lead.clientInn}</Field>}
            {lead.organizationName && (
              <Field label='Организация партнёра'>
                <Link
                  href={`/partner/portfolio/${lead.organizationId}`}
                  className='text-[#F97316] hover:underline'
                >
                  {lead.organizationName}
                </Link>
              </Field>
            )}
          </Card>

          <Card title='Контакт'>
            <Field label='Имя'>{lead.clientContactName}</Field>
            {lead.clientContactPhone && <Field label='Телефон'>{lead.clientContactPhone}</Field>}
            {lead.clientContactEmail && <Field label='Email'>{lead.clientContactEmail}</Field>}
          </Card>

          <Card title='Запрос'>
            <Field label='Тема'>{lead.subject}</Field>
            <Field label='Оценочная сумма'>{fmtMoney(lead.estimatedAmount)}</Field>
            {lead.productType.length > 0 && (
              <Field label='Тип услуг'>
                <div className='flex flex-wrap gap-1'>
                  {lead.productType.map((p) => (
                    <span
                      key={p}
                      className='px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded-full'
                    >
                      {PRODUCT_LABEL[p] ?? p}
                    </span>
                  ))}
                </div>
              </Field>
            )}
            {lead.notes && (
              <Field label='Комментарий'>
                <div className='whitespace-pre-wrap text-gray-700'>{lead.notes}</div>
              </Field>
            )}
          </Card>

          <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-3'>
            <h2 className='text-sm font-semibold text-[#111111]'>Вложения</h2>
            <LeadAttachmentsList
              leadId={lead.id}
              rows={attachments.map((a) => ({
                id: a.id,
                name: a.name,
                size: a.size,
                mimeType: a.mimeType,
                createdAt: a.createdAt.toISOString(),
                createdByUserId: a.createdByUserId,
                createdByUserName: a.createdByUserName
              }))}
              canDelete={canEditAttachments}
              currentUserId={session.sub}
              isPartnerAdmin={partnerAdmin}
            />
            {canEditAttachments && <LeadAttachmentDropzone leadId={lead.id} />}
          </div>
        </div>

        <div className='space-y-4'>
          <Card title='Хронология'>
            <Field label='Создана'>{fmtDateTime(lead.createdAt)}</Field>
            <Field label='Автор'>{lead.createdByUserName}</Field>
            {lead.assignedManagerName && (
              <Field label='Менеджер'>{lead.assignedManagerName}</Field>
            )}
            {lead.updatedAt.getTime() !== lead.createdAt.getTime() && (
              <Field label='Изменена'>{fmtDateTime(lead.updatedAt)}</Field>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-2'>
      <h2 className='text-sm font-semibold text-[#111111]'>{title}</h2>
      <dl className='space-y-1.5'>{children}</dl>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='grid grid-cols-3 gap-2 text-sm'>
      <dt className='text-gray-500'>{label}</dt>
      <dd className='col-span-2 text-[#111111]'>{children}</dd>
    </div>
  );
}
