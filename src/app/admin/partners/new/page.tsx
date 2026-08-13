import React from 'react';
import { Breadcrumbs } from '@/components/ui';
import { requireAdmin } from '@/lib/auth/requireRole';
import { PartnerCreateForm } from '@/components/admin/partner-create-form';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';

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
        <h1 className="text-2xl font-bold text-[#111111] mt-1">Новый партнёр</h1>
        {/* `У-73`: одна строка «что здесь делают». */}
        <p className="text-sm text-gray-500 mt-0.5">
          Заведите партнёра, который будет приводить клиентов и получать комиссию
        </p>
      </div>
      <PartnerCreateForm />
    </div>
  );
}
