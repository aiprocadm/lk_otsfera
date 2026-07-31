import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getTelegramStatus } from '@/lib/services/telegram/link';
import { getNotificationSettings } from '@/lib/services/notifications/preferences';
import { TelegramLinkCard } from '@/components/settings/telegram-link-card';
import { NotificationChannelsCard } from '@/components/settings/notification-channels-card';
import { StaffBackupCodesSection } from '@/components/settings/staff-backup-codes-section';
import { SecurityCard } from '@/components/settings/security-card';
import { FeatureFlagsMatrix } from '@/components/admin/feature-flags-matrix';
import { RequisitesCard } from '@/components/requisites/requisites-card';
import { Input, Field } from '@/components/ui';
import { listCompaniesRequisites } from '@/lib/services/admin/companyRequisites';
import { setCompanyRequisitesAction } from '@/server-actions/requisites';

export default async function AdminSettingsPage() {
  const session = await requireAdmin();
  const status = await getTelegramStatus(prisma, session);
  const settings = await getNotificationSettings(prisma, session);
  // Этап 8 (ФТ-9.2): реквизиты исполнителя (Company) — шапка счетов/актов.
  const companies = await listCompaniesRequisites(prisma, session);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#111111]">Настройки</h1>
      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <span aria-hidden className="mr-1">
          ℹ️
        </span>
        Личные настройки уведомлений — здесь. Интеграции платформы (почта, телефония Mango, боты
        Telegram/Max/WhatsApp, 1С, DaData) настраиваются и проверяются на странице «Интеграции».
      </div>
      <TelegramLinkCard status={status} />
      <NotificationChannelsCard settings={settings.view} />
      {isFeatureEnabled('staff_2fa') ? <StaffBackupCodesSection /> : null}
      <SecurityCard />
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
      <FeatureFlagsMatrix />
    </div>
  );
}
