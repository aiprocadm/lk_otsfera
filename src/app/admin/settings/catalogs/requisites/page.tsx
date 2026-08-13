import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { RequisitesCard } from '@/components/requisites/requisites-card';
import { Input, Field } from '@/components/ui';
import { listCompaniesRequisites } from '@/lib/services/admin/companyRequisites';
import { setCompanyRequisitesAction } from '@/server-actions/requisites';

export const metadata: Metadata = { title: 'Реквизиты исполнителя · Настройки' };

/**
 * Этап 8 (ФТ-9.2): реквизиты исполнителя (Company) — шапка счетов и актов.
 * Переехало с общей страницы /admin/settings в хаб (ТЗ 2026-08-04), логика та же.
 */
export default async function AdminRequisitesPage() {
  const session = await requireSettingsSection('catalogs.requisites', 'admin');
  const companies = await listCompaniesRequisites(prisma, session);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#111111]">Реквизиты исполнителя</h1>
      {/* `У-73`: одна строка «что здесь делают». */}
      <p className="text-sm text-gray-500 mt-0.5">
        Реквизиты вашей компании — их подставляют счета и акты
      </p>
      {companies.ok &&
        companies.companies.map((c) => (
          <RequisitesCard
            key={c.id}
            title={`Реквизиты исполнителя: ${c.name}`}
            description="Подставляются в шапку формируемых счетов и актов (этап 8)."
            defaults={c}
            idPrefix={`co-req-${c.id}`}
            action={setCompanyRequisitesAction}
            hidden={{ companyId: c.id }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field htmlFor={`co-req-${c.id}-phone`} label="Телефон (шапка документов)">
                <Input
                  id={`co-req-${c.id}-phone`}
                  name="phone"
                  maxLength={30}
                  defaultValue={c.phone ?? ''}
                />
              </Field>
              <Field htmlFor={`co-req-${c.id}-email`} label="Email (шапка документов)">
                <Input
                  id={`co-req-${c.id}-email`}
                  name="email"
                  maxLength={200}
                  defaultValue={c.email ?? ''}
                />
              </Field>
            </div>
          </RequisitesCard>
        ))}
    </div>
  );
}
