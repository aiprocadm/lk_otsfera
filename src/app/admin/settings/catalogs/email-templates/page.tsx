import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listTemplates } from '@/lib/email/templateOverrides';
import { EmailTemplatesScreen } from '@/components/settings/email-templates-screen';

export const metadata: Metadata = { title: 'Тексты писем · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Тексты писем» администратора: платформенный уровень (`У-128`).
 * База — здесь, в слое app: компонент презентационный (`components-no-db`).
 */
export default async function AdminEmailTemplatesPage() {
  await requireSettingsSection('catalogs.emailTemplates', 'admin');
  const rows = await listTemplates(prisma, null);

  return <EmailTemplatesScreen cabinet="admin" hasCompany rows={rows} />;
}
