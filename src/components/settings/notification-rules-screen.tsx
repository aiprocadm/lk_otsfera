import React from 'react';
import { PageHeader } from '@/components/ui/page-header';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import type { RuleRow } from '@/lib/notifications/routing';
import { NotificationRulesTable } from './notification-rules-table';

/**
 * «Правила уведомлений» — экран общий для администратора и руководителя
 * (`У-127`, решение `Р-23`).
 *
 * Компонент **презентационный**: данные приходят пропсами, в базу он не ходит
 * (правило `components-no-db`). Разметка одна, различается только область
 * действия, и её задаёт **сервер** по роли: администратор видит и правит
 * правила платформы, руководитель — своей компании поверх платформенных.
 * Компанию страница берёт из сессии, а не из адреса: иначе руководитель одной
 * компании читал бы правила другой.
 */
export function NotificationRulesScreen({
  cabinet,
  hasCompany,
  rows,
}: {
  cabinet: SettingsCabinet;
  /** У руководителя без компании настраивать нечего — экран объясняет это. */
  hasCompany: boolean;
  rows: RuleRow[];
}) {
  const isAdmin = cabinet === 'admin';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Правила уведомлений"
        subtitle={
          isAdmin
            ? 'Какое событие кому и каким каналом отправлять. Эти правила действуют на всей платформе.'
            : 'Какое событие кому и каким каналом отправлять вашим клиентам. Ваши правила важнее общих.'
        }
      />

      {!isAdmin && !hasCompany ? (
        <p role="alert" className="text-sm text-red-600">
          У вашей учётной записи не указана компания — правила настроить нельзя. Обратитесь к
          администратору.
        </p>
      ) : (
        <NotificationRulesTable cabinet={cabinet} rows={rows} />
      )}
    </div>
  );
}
