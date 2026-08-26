import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listRoutingRules } from '@/lib/notifications/routing';
import { NotificationRulesScreen } from '@/components/settings/notification-rules-screen';

export const metadata: Metadata = { title: 'Правила уведомлений · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Правила уведомлений» администратора: платформенный уровень (`У-127`).
 * База — здесь, в слое app: компонент презентационный (`components-no-db`).
 */
export default async function AdminNotificationRulesPage() {
  await requireSettingsSection('catalogs.notificationRules', 'admin');
  const rows = await listRoutingRules(prisma, null);
  return <NotificationRulesScreen cabinet="admin" hasCompany rows={rows} />;
}
