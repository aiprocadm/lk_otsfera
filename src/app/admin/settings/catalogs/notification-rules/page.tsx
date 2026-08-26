import type { Metadata } from 'next';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { NotificationRulesScreen } from '@/components/settings/notification-rules-screen';

export const metadata: Metadata = { title: 'Правила уведомлений · Настройки' };

export const dynamic = 'force-dynamic';

/** «Правила уведомлений» администратора: платформенный уровень (`У-127`). */
export default async function AdminNotificationRulesPage() {
  const session = await requireSettingsSection('catalogs.notificationRules', 'admin');
  return NotificationRulesScreen({ session, cabinet: 'admin' });
}
