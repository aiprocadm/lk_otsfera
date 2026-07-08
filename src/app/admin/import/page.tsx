import React from 'react';
import { requireAdmin } from '@/lib/auth/requireRole';
import { ImportForm } from '@/components/import/import-form';

export const dynamic = 'force-dynamic';

export default async function AdminImportPage() {
  await requireAdmin();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Загрузка данных из 1С</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Загрузите файл Excel, сформированный в 1С. Предварительная проверка покажет план
          изменений до их применения.
        </p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <ImportForm />
      </div>
    </div>
  );
}
