import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getCustomFieldsScreen } from '@/lib/services/customFields/screen';
import { CustomFieldsAdmin } from '@/components/admin/custom-fields-admin';

export const dynamic = 'force-dynamic';

/**
 * §11 + §4 ТЗ v0.5: настройку полей ведут администратор И руководитель.
 * Руководителя не пускаем в `/admin/*` (Model A, §4 CLAUDE.md) — вместо этого
 * зеркало в его кабинете поверх того же компонента и того же сервиса.
 */
export default async function LeaderCustomFieldsPage({
  searchParams
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const session = await requireManagerLeader();
  const sp = await searchParams;
  const screen = await getCustomFieldsScreen(prisma, session, sp.entity);

  return (
    <CustomFieldsAdmin
      entity={screen.entity}
      definitions={screen.definitions}
      systemFields={screen.systemFields}
      basePath="/leader/settings/custom-fields"
    />
  );
}
