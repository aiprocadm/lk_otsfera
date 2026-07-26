import React from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BackLink, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getPartner } from '@/lib/services/admin/partners';
import { listRateHistory } from '@/lib/services/commission/rateHistory';
import { PartnerEditForm } from '@/components/admin/partner-edit-form';
import { RequisitesCard } from '@/components/requisites/requisites-card';
import { getPartnerRequisitesByAdmin } from '@/lib/services/admin/counterpartyRequisites';
import { setPartnerRequisitesByAdminAction } from '@/server-actions/requisites';
import { fmtDate } from '@/lib/format';

const fmtRate = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 2 });

export const dynamic = 'force-dynamic';

export default async function EditPartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  const { id } = await params;
  const [partner, rateHistoryResult] = await Promise.all([
    getPartner(prisma, id),
    listRateHistory(prisma, session, id)
  ]);
  if (!partner) notFound();
  const rateHistory = rateHistoryResult.ok ? rateHistoryResult.rows : [];
  // Этап 8 (ФТ-9.2): полный набор реквизитов для автогенерации документов.
  const requisites = await getPartnerRequisitesByAdmin(prisma, session, partner.id);

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <BackLink href='/admin/partners' label='Все партнёры' />
        <h1 className="text-2xl font-bold text-[#111111] mt-1">Партнёр: {partner.name}</h1>
        <p className="text-sm text-gray-500">slug: {partner.slug}</p>
      </div>

      <PartnerEditForm partner={partner} />
      {requisites && (
        <RequisitesCard
          title='Реквизиты для документов'
          description='Полный набор реквизитов партнёра для автогенерации документов (этап 8).'
          defaults={requisites}
          idPrefix='adm-pt-req'
          action={setPartnerRequisitesByAdminAction}
          hidden={{ partnerId: partner.id }}
        />
      )}

      <div>
        <h2 className="text-lg font-semibold text-[#111111] mb-3">История ставок комиссии</h2>
        {rateHistory.length === 0 ? (
          <p className="text-sm text-gray-500">История изменений ставки отсутствует.</p>
        ) : (
          <TableShell>
            <THead className="bg-[#F3F4F6]">
              <Th className="py-2 text-[#111111]">Дата</Th>
              <Th className="py-2 text-[#111111]">Было</Th>
              <Th className="py-2 text-[#111111]">Стало</Th>
              <Th className="py-2 text-[#111111]">Кто</Th>
            </THead>
            <tbody>
              {rateHistory.map((row) => (
                <Tr key={row.id} hover={false} className="border-gray-100">
                  <Td className="py-2 text-gray-700">{fmtDate(row.effectiveFrom)}</Td>
                  <Td className="py-2 text-gray-700">
                    {row.oldRate !== null ? fmtRate.format(row.oldRate) : '—'}
                  </Td>
                  <Td className="py-2 text-gray-700">{fmtRate.format(row.newRate)}</Td>
                  <Td className="py-2 text-gray-500">{row.changedByName ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-[#111111] mb-3">
          Администраторы партнёра ({partner.admins.length})
        </h2>
        {partner.admins.length === 0 ? (
          <p className="text-sm text-gray-500">Нет администраторов.</p>
        ) : (
          <TableShell>
            <THead className="bg-[#F3F4F6]">
              <Th className="py-2 text-[#111111]">Email</Th>
              <Th className="py-2 text-[#111111]">Имя</Th>
              <Th className="py-2 text-[#111111]">Активен</Th>
              <Th className="py-2 text-[#111111]">Создан</Th>
              <Th className="py-2 text-[#111111]">Действия</Th>
            </THead>
            <tbody>
              {partner.admins.map((admin) => (
                <Tr key={admin.partnerUserId} hover={false} className="border-gray-100">
                  <Td className="py-2 text-gray-700">{admin.email}</Td>
                  <Td className="py-2 text-gray-700">{admin.name}</Td>
                  <Td className="py-2">
                    {admin.isActive ? (
                      <span className="text-green-600">Да</span>
                    ) : (
                      <span className="text-red-500">Нет</span>
                    )}
                  </Td>
                  <Td className="py-2 text-gray-500">
                    {fmtDate(admin.createdAt)}
                  </Td>
                  <Td className="py-2">
                    <Link
                      href={`/admin/users/${admin.userId}`}
                      className="text-[#F97316] hover:text-[#EA580C] text-xs"
                    >
                      Открыть
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </div>
    </div>
  );
}
