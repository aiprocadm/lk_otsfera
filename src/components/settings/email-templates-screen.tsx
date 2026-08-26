import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { listTemplates } from '@/lib/email/templateOverrides';
import { PageHeader } from '@/components/ui/page-header';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import type { SessionPayload } from '@/lib/auth/jwt';
import { EmailTemplatesEditor } from './email-templates-editor';

/**
 * «Тексты писем» — экран общий для администратора и руководителя (`У-128`,
 * решение `Р-23`). Область действия задаёт сервер по роли, а не адрес.
 */
export async function EmailTemplatesScreen({
  session,
  cabinet,
}: {
  session: SessionPayload;
  cabinet: SettingsCabinet;
}) {
  const isAdmin = cabinet === 'admin';
  const companyId = isAdmin ? null : (session.companyId ?? null);
  const rows = await listTemplates(prisma, companyId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Тексты писем"
        subtitle={
          isAdmin
            ? 'Своя тема и текст вместо стандартных. Эти тексты действуют на всей платформе.'
            : 'Своя тема и текст вместо стандартных — для писем вашей компании.'
        }
      />

      {!isAdmin && !companyId ? (
        <p role="alert" className="text-sm text-red-600">
          У вашей учётной записи не указана компания — тексты настроить нельзя. Обратитесь к
          администратору.
        </p>
      ) : (
        <EmailTemplatesEditor cabinet={cabinet} rows={rows} />
      )}
    </div>
  );
}
