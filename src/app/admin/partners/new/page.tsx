import React from 'react';
import { BackLink } from '@/components/ui';
import { requireAdmin } from '@/lib/auth/requireRole';
import { PartnerCreateForm } from '@/components/admin/partner-create-form';

export const dynamic = 'force-dynamic';

export default async function NewPartnerPage() {
  await requireAdmin();
  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <BackLink href='/admin/partners' label='Все партнёры' />
        <h1 className="text-2xl font-bold text-[#111111] mt-1">Новый партнёр</h1>
      </div>
      <PartnerCreateForm />
    </div>
  );
}
