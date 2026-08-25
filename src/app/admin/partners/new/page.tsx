import React from 'react';
import { Breadcrumbs } from '@/components/ui';
import { requireAdmin } from '@/lib/auth/requireRole';
import { PartnerCreateForm } from '@/components/admin/partner-create-form';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

export default async function NewPartnerPage() {
  await requireAdmin();
  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        {/* `У-72`: полный путь до экрана вместо одиночного «назад». */}
        <Breadcrumbs
          items={buildCabinetBreadcrumbs('admin', '/admin/partners', [{ label: 'Новый партнёр' }])}
        />
        <PageHeader
          title="Новый партнёр"
          subtitle="Заведите партнёра, который будет приводить клиентов и получать комиссию"
        />
      </div>
      <PartnerCreateForm />
    </div>
  );
}
