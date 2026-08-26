import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listTemplates } from '@/lib/email/templateOverrides';
import { EmailTemplatesScreen } from '@/components/settings/email-templates-screen';

export const metadata: Metadata = { title: 'Тексты писем · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Тексты писем» руководителя: тексты своей компании поверх платформенных
 * (`У-128`). Экран тот же, область действия задаёт сервер.
 * База — здесь, в слое app: компонент презентационный (`components-no-db`).
 */
export default async function LeaderEmailTemplatesPage() {
  const session = await requireSettingsSection('catalogs.emailTemplates', 'leader');
  const companyId = session.companyId ?? null;
  const rows = await listTemplates(prisma, companyId);

  return <EmailTemplatesScreen cabinet="leader" hasCompany={Boolean(companyId)} rows={rows} />;
}
