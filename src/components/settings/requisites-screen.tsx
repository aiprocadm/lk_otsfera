import React from 'react';
import { RequisitesCard } from '@/components/requisites/requisites-card';
import { Input, Field } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import type { CompanyRequisites } from '@/lib/services/admin/companyRequisites';
import { setCompanyRequisitesAction } from '@/server-actions/requisites';
import type { SettingsCabinet } from '@/lib/navigation/settings';

/**
 * «Реквизиты исполнителя» — экран общий для администратора и руководителя
 * (`У-135`, решение `Р-23`).
 *
 * Компонент **презентационный**: данные приходят пропсами, в базу он не ходит
 * (правило `components-no-db`). Выборку делает страница своей роли, скоуп —
 * сервис: админ видит все компании, руководитель — только свою. Форма шлёт
 * `companyId`, но сервис сверяет его с сессией — чужую компанию руководитель
 * не изменит, даже подделав скрытое поле.
 */
export function RequisitesScreen({
  cabinet,
  hasCompany,
  companies,
}: {
  cabinet: SettingsCabinet;
  /** У руководителя без компании настраивать нечего — экран объясняет это. */
  hasCompany: boolean;
  companies: CompanyRequisites[];
}) {
  const isAdmin = cabinet === 'admin';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Реквизиты исполнителя"
        subtitle="Реквизиты вашей компании — их подставляют счета и акты"
      />

      {!isAdmin && !hasCompany ? (
        <p role="alert" className="text-sm text-red-600">
          У вашей учётной записи не указана компания — реквизиты настроить нельзя. Обратитесь к
          администратору.
        </p>
      ) : (
        companies.map((c) => (
          <RequisitesCard
            key={c.id}
            title={`Реквизиты исполнителя: ${c.name}`}
            description="Подставляются в шапку формируемых счетов и актов (этап 8)."
            defaults={c}
            idPrefix={`co-req-${c.id}`}
            // bind: server-action с предвязанным кабинетом сериализуется в
            // клиентский компонент штатно (в отличие от стрелки).
            action={setCompanyRequisitesAction.bind(null, cabinet)}
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
        ))
      )}
    </div>
  );
}
