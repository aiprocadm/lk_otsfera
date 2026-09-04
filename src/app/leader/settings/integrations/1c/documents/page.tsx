import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import {
  listExportCandidates,
  parseExportPackageFilter,
  type ExportPackageQuery,
} from '@/lib/services/oneCSync/exportPackage';
import { OneCDocumentsExportScreen } from '@/components/settings/one-c-documents-export-screen';

export const metadata: Metadata = { title: 'Выгрузка документов · Обмен с 1С' };
export const dynamic = 'force-dynamic';

/**
 * Вкладка «Выгрузка документов» руководителя (`У-173`, этап 8): пакет
 * документов для 1С файлом. Экран общий с соседним кабинетом (правило зеркала
 * §15); база — здесь, в слое app. Руководитель видит только документы своей компании —
 * скоуп режет сервис, а не страница.
 */
export default async function LeaderOneCDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<ExportPackageQuery>;
}) {
  const session = await requireSettingsSection('integrations.oneC', 'leader');
  const sp = await searchParams;
  const res = await listExportCandidates(prisma, session, parseExportPackageFilter(sp));

  if (!res.ok) {
    return (
      <p role="alert" className="text-sm text-red-600">
        Недостаточно прав, чтобы собирать пакет документов для 1С.
      </p>
    );
  }
  return (
    <OneCDocumentsExportScreen
      cabinet="leader"
      sp={sp}
      items={res.items}
      ready={res.ready}
      truncated={res.truncated}
    />
  );
}
