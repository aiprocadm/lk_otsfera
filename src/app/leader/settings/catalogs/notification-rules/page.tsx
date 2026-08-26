import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listRoutingRules } from '@/lib/notifications/routing';
import { NotificationRulesScreen } from '@/components/settings/notification-rules-screen';

export const metadata: Metadata = { title: 'Правила уведомлений · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Правила уведомлений» руководителя: правила своей компании поверх
 * платформенных (`У-127`). Экран тот же, область действия задаёт сервер:
 * компания берётся из сессии, а не из адреса. База — здесь, в слое app:
 * компонент презентационный (`components-no-db`).
 */
export default async function LeaderNotificationRulesPage() {
  const session = await requireSettingsSection('catalogs.notificationRules', 'leader');
  const companyId = session.companyId ?? null;
  const rows = await listRoutingRules(prisma, companyId);
  return <NotificationRulesScreen cabinet="leader" hasCompany={Boolean(companyId)} rows={rows} />;
}
