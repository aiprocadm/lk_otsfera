import type { Metadata } from 'next';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { EmailTemplatesScreen } from '@/components/settings/email-templates-screen';

export const metadata: Metadata = { title: 'Тексты писем · Настройки' };

export const dynamic = 'force-dynamic';

/** «Тексты писем» администратора: платформенный уровень (`У-128`). */
export default async function AdminEmailTemplatesPage() {
  const session = await requireSettingsSection('catalogs.emailTemplates', 'admin');
  return EmailTemplatesScreen({ session, cabinet: 'admin' });
}
