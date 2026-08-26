import type { Metadata } from 'next';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { EmailTemplatesScreen } from '@/components/settings/email-templates-screen';

export const metadata: Metadata = { title: 'Тексты писем · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Тексты писем» руководителя: тексты своей компании поверх платформенных
 * (`У-128`). Экран тот же, область действия задаёт сервер.
 */
export default async function LeaderEmailTemplatesPage() {
  const session = await requireSettingsSection('catalogs.emailTemplates', 'leader');
  return EmailTemplatesScreen({ session, cabinet: 'leader' });
}
