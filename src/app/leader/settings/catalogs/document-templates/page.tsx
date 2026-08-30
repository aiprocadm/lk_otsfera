import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listCompanyTemplates } from '@/lib/services/documents/templates';
import { DocumentTemplatesScreen } from '@/components/settings/document-templates-screen';

export const metadata: Metadata = { title: 'Шаблоны документов · Настройки' };

/**
 * «Шаблоны документов» руководителя (`У-160`, `Р-22`): только своя компания —
 * границу держит сервис сравнением companyId, а не скрытый селект. Экран общий
 * с админом; база — здесь, в слое app (`components-no-db`).
 */
export default async function LeaderDocumentTemplatesPage() {
  const session = await requireSettingsSection('catalogs.documentTemplates', 'leader');
  const activeCompanyId = session.companyId ?? null;

  // Без компании в сессии тексты не читаем вовсе: экран объяснит, что не так.
  const templates = activeCompanyId
    ? await listCompanyTemplates(prisma, session, activeCompanyId)
    : { ok: true as const, rows: [] };

  return (
    <DocumentTemplatesScreen
      cabinet="leader"
      hasCompany={Boolean(session.companyId)}
      companies={[]}
      activeCompanyId={activeCompanyId}
      rows={templates.ok ? templates.rows : []}
    />
  );
}
