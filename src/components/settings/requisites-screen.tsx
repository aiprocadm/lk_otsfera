import React from 'react';
import { RequisitesCard } from '@/components/requisites/requisites-card';
import { Input, Field } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import { CompanyBrandingSlots } from '@/components/settings/company-branding-slots';
import {
  CompanyNumberingForm,
  CompanyTaxForm,
} from '@/components/settings/company-tax-numbering-forms';
import { CompanyOneCPushRuleForm } from '@/components/settings/company-onec-push-rule-form';
import type { CompanyRequisites } from '@/lib/services/admin/companyRequisites';
import type { BrandingSlotView } from '@/lib/services/admin/companyBranding';
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
 *
 * `У-138`: под реквизитами каждой компании — «Налоги», «Нумерация документов»
 * и «Оформление документов» (логотип · подпись · печать).
 */
export function RequisitesScreen({
  cabinet,
  hasCompany,
  companies,
  brandingByCompany,
}: {
  cabinet: SettingsCabinet;
  /** У руководителя без компании настраивать нечего — экран объясняет это. */
  hasCompany: boolean;
  companies: CompanyRequisites[];
  /** Слоты оформления по companyId — существующие файлы со статусом проверки. */
  brandingByCompany: Record<string, BrandingSlotView[]>;
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
          <div key={c.id} className="space-y-4">
            <RequisitesCard
              title={`Реквизиты исполнителя: ${c.name}`}
              description="Подставляются в шапку формируемых счетов и актов."
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

            <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-[#111111]">Налоги</h2>
                {/* §15: подзаголовок объясняет, что здесь делают. */}
                <p className="text-xs text-gray-500">
                  Ставка НДС по умолчанию — подставляется в новые строки заказов и документы.
                </p>
              </div>
              <CompanyTaxForm
                cabinet={cabinet}
                companyId={c.id}
                defaultVatRate={c.defaultVatRate}
                pricesIncludeVat={c.pricesIncludeVat}
              />
            </section>

            <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-[#111111]">Нумерация документов</h2>
                <p className="text-xs text-gray-500">
                  Префиксы номеров счетов, актов и договоров этой компании.
                </p>
              </div>
              <CompanyNumberingForm cabinet={cabinet} companyId={c.id} numbering={c.numbering} />
            </section>

            <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-[#111111]">Оформление документов</h2>
                <p className="text-xs text-gray-500">
                  Логотип, подпись и печать для документов — файлы проходят проверку антивирусом.
                </p>
              </div>
              <CompanyBrandingSlots
                cabinet={cabinet}
                companyId={c.id}
                slots={brandingByCompany[c.id] ?? []}
              />
            </section>

            {/* `У-169` (этап 8): правило выгрузки — у каждой компании своё. */}
            <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-[#111111]">Выгрузка документов в 1С</h2>
                <p className="text-xs text-gray-500">
                  Когда отправлять выпущенные документы в 1С и какие именно — счёт, акт, договор,
                  доп. соглашение.
                </p>
              </div>
              <CompanyOneCPushRuleForm
                cabinet={cabinet}
                companyId={c.id}
                mode={c.oneCDocumentPushMode}
                types={c.oneCDocumentPushTypes}
              />
            </section>
          </div>
        ))
      )}
    </div>
  );
}
