import React from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requirePartnerAdmin } from '@/lib/auth/requireRole';
import { canPartnerAccessOrg } from '@/lib/auth/policy';
import { getOrgCard } from '@/lib/services/partner/orgCard';
import { OrgCardHeader } from '@/components/partner/org-card-header';
import { OrgTabs } from '@/components/partner/org-tabs';

export default async function OrgSettingsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const session = await requirePartnerAdmin();

  const { orgId } = await params;
  const access = await canPartnerAccessOrg(session, orgId);
  if (!access) redirect('/forbidden');

  const card = await getOrgCard(prisma, { orgId, partnerId: session.partnerId });
  if (!card) notFound();

  return (
    <div className="space-y-4">
      <OrgCardHeader card={card} />
      <OrgTabs orgId={orgId} active="settings" isAdmin={true} />

      {/*
       * У-1/Р-4: формы смены ставки комиссии здесь больше нет — ставку назначает
       * учебный центр. §15 CLAUDE.md: экран без подзаголовка и без действия —
       * дефект приёмки, поэтому вкладка объясняет себя и даёт выход.
       */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[#111111]">Настройки организации</h2>
          <p className="text-sm text-gray-600 mt-1">
            Условия работы по этой организации. Ставку комиссии назначает учебный центр.
          </p>
        </div>

        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
          <p className="text-sm text-gray-700">Здесь пока нечего менять.</p>
          <p className="text-xs text-gray-500 mt-1">
            Нужно изменить условия — напишите менеджеру учебного центра.
          </p>
          <Link
            href={`/partner/portfolio/${orgId}?tab=comments`}
            className="inline-block mt-3 px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]"
          >
            Написать менеджеру
          </Link>
        </div>
      </section>
    </div>
  );
}
