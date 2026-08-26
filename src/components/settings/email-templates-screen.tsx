import React from 'react';
import { PageHeader } from '@/components/ui/page-header';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import type { TemplateRow } from '@/lib/email/templateOverrides';
import { EmailTemplatesEditor } from './email-templates-editor';

/**
 * «Тексты писем» — экран общий для администратора и руководителя (`У-128`,
 * решение `Р-23`). Область действия задаёт сервер по роли, а не адрес.
 *
 * Компонент **презентационный**: данные приходят пропсами, в базу он не ходит
 * (правило `components-no-db`). Выборку делает страница своей роли: админ
 * правит платформенный уровень, руководитель — тексты своей компании.
 */
export function EmailTemplatesScreen({
  cabinet,
  hasCompany,
  rows,
}: {
  cabinet: SettingsCabinet;
  /** У руководителя без компании настраивать нечего — экран объясняет это. */
  hasCompany: boolean;
  rows: TemplateRow[];
}) {
  const isAdmin = cabinet === 'admin';

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

      {!isAdmin && !hasCompany ? (
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
