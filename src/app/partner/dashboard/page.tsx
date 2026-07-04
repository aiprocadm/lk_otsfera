import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { kpis, attention, recentEvents } from '@/lib/services/partner/dashboard';
import { KpiGrid } from '@/components/partner/kpi-grid';
import { AttentionList } from '@/components/partner/attention-list';
import { EventsFeed } from '@/components/partner/events-feed';

export default async function PartnerDashboard() {
  const session = await requirePartner();

  const scope = {
    partnerId: session.partnerId,
    scopeOrgIds: session.assignedOrgIds ?? []
  };

  const [k, a, events] = await Promise.all([
    kpis(prisma, scope),
    attention(prisma, scope),
    recentEvents(prisma, scope, 10)
  ]);

  return (
    <div className='space-y-5'>
      <div>
        <h1 className='text-2xl font-bold text-[#111111]'>Кабинет партнёра</h1>
        <p className='text-sm text-gray-500 mt-0.5'>Обзор ключевых показателей и активности</p>
      </div>

      <KpiGrid kpis={k} />

      <div className='grid gap-4 md:grid-cols-2'>
        <AttentionList data={a} />
        <EventsFeed events={events} />
      </div>
    </div>
  );
}
