import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { isManagerLeader } from '@/lib/auth/roleModel';
import { getTelegramStatus } from '@/lib/services/telegram/link';
import { getNotificationSettings } from '@/lib/services/notifications/preferences';
import { getStaffInternalPhone } from '@/lib/services/manager/staffProfile';
import { readPersonalSettingsTab } from '@/lib/navigation/personalSettingsTab';
import { StaffPersonalSettings } from '@/components/settings/staff-personal-settings';

export const metadata: Metadata = { title: 'Личные настройки · Настройки' };

/**
 * `У-114`: «Каналы уведомлений» и «Личная безопасность» слиты в один раздел с
 * теми же вкладками, что у менеджера, партнёра и заказчика. Гард раздела
 * вызывается на КАЖДЫЙ запрос (§2b); база — здесь, в слое app: компонент
 * презентационный (`components-no-db`). Данные грузятся только для открытой
 * вкладки.
 */
export default async function AdminPersonalSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireSettingsSection('personal.settings', 'admin');
  const tab = readPersonalSettingsTab((await searchParams).tab);

  // Внутренний номер — только менеджерский контур: click-to-call через Mango
  // инициирует руководитель, а `updateInternalPhoneAction` админа и не пустит.
  const withPhone = isManagerLeader(session);

  const profile =
    tab === 'profile'
      ? {
          telegram: await getTelegramStatus(prisma, session),
          internalPhone: withPhone ? await getStaffInternalPhone(prisma, session) : null,
        }
      : null;
  const notifications =
    tab === 'notifications' ? (await getNotificationSettings(prisma, session)).view : null;

  return (
    <StaffPersonalSettings
      cabinet="admin"
      activeTab={tab}
      withPhone={withPhone}
      profile={profile}
      notifications={notifications}
    />
  );
}
