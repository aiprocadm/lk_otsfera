import React from 'react';
import { notFound } from 'next/navigation';
import { requirePartner } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listClientRequests } from '@/lib/services/clientRequests/list';
import { ClientRequestForm } from '@/components/client-requests/client-request-form';
import { ClientRequestList } from '@/components/client-requests/client-request-list';

export const dynamic = 'force-dynamic';

/** Мои заявки партнёра — обращения в поддержку (этап 5, ФТ-1.2/1.3): форма подачи + свои обращения. */
export default async function PartnerRequestsPage() {
  if (!isFeatureEnabled('client_requests')) notFound();
  const session = await requirePartner();
  const { rows } = await listClientRequests(prisma, session, {});
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[#111111]">Мои заявки</h1>
        {/* Этап 11 PR-3 (решение §5-1): термин ТЗ — «Мои заявки». Чтобы он не
            смешивался с «Заявкой на обучение», подзаголовок проговаривает суть. */}
        <p className="mt-1 text-sm text-gray-600">
          Обращения в поддержку: вопрос, запрос расчёта или новая потребность. Заявки на обучение
          слушателей подаются в разделе «Заявки на обучение».
        </p>
      </div>
      <ClientRequestForm />
      <ClientRequestList rows={rows} detailHrefBase="/partner/requests" />
    </div>
  );
}
