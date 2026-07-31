import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requirePartnerAdmin } from '@/lib/auth/requireRole';
import { canPartnerAccessOrg } from '@/lib/auth/policy';
import { getOrgCard } from '@/lib/services/partner/orgCard';
import { OrgCardHeader } from '@/components/partner/org-card-header';
import { OrgTabs } from '@/components/partner/org-tabs';
import { RateOverrideForm } from '@/components/partner/rate-override-form';

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
      <RateOverrideForm
        orgId={orgId}
        initialRate={card.partnerCommissionRate}
        initialNote={card.partnerCommissionRateNote}
      />
    </div>
  );
}
