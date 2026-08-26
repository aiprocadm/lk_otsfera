import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { listRoutingRules } from '@/lib/notifications/routing';
import { NotificationRulesTable } from './notification-rules-table';
import { PageHeader } from '@/components/ui/page-header';
import type { SettingsCabinet } from '@/lib/navigation/settings';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * «Правила уведомлений» — экран общий для администратора и руководителя
 * (`У-127`, решение `Р-23`).
 *
 * Разметка одна, различается только область действия, и её задаёт **сервер**
 * по роли: администратор видит и правит правила платформы, руководитель —
 * своей компании поверх платформенных. Компанию берём из сессии, а не из
 * адреса: иначе руководитель одной компании читал бы правила другой.
 */
export async function NotificationRulesScreen({
  session,
  cabinet,
}: {
  session: SessionPayload;
  cabinet: SettingsCabinet;
}) {
  const isAdmin = cabinet === 'admin';
  const companyId = isAdmin ? null : (session.companyId ?? null);
  const rows = await listRoutingRules(prisma, companyId);

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

      {!isAdmin && !companyId ? (
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
