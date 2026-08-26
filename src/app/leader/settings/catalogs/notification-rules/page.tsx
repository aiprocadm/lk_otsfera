import type { Metadata } from 'next';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { NotificationRulesScreen } from '@/components/settings/notification-rules-screen';

export const metadata: Metadata = { title: 'Правила уведомлений · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Правила уведомлений» руководителя: правила своей компании поверх
 * платформенных (`У-127`). Экран тот же, область действия задаёт сервер.
 */
export default async function LeaderNotificationRulesPage() {
  const session = await requireSettingsSection('catalogs.notificationRules', 'leader');
  return NotificationRulesScreen({ session, cabinet: 'leader' });
}
