import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listCompanyOptions } from '@/lib/services/admin/orders';
import { listCompanyTemplates } from '@/lib/services/documents/templates';
import { DocumentTemplatesScreen } from '@/components/settings/document-templates-screen';

export const metadata: Metadata = { title: 'Шаблоны документов · Настройки' };

/**
 * Этап 6 (`У-160`): тексты пунктов договора и доп. соглашения. Админ видит все
 * компании и выбирает явно (`?company=`), по умолчанию первую по алфавиту.
 * Границу компании проверяет сервис, а не селект. База — здесь, в слое app:
 * компонент презентационный (`components-no-db`).
 */
export default async function AdminDocumentTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const session = await requireSettingsSection('catalogs.documentTemplates', 'admin');
  const params = await searchParams;
  const companies = await listCompanyOptions(prisma);
  const activeCompanyId = params.company || companies[0]?.id || null;

  const templates = activeCompanyId
    ? await listCompanyTemplates(prisma, session, activeCompanyId)
    : { ok: true as const, rows: [] };

  return (
    <DocumentTemplatesScreen
      cabinet="admin"
      hasCompany={companies.length > 0}
      companies={companies}
      activeCompanyId={activeCompanyId}
      rows={templates.ok ? templates.rows : []}
    />
  );
}
