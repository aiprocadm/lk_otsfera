import React from 'react';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getCustomFieldsScreen } from '@/lib/services/customFields/screen';
import { CustomFieldsAdmin } from '@/components/admin/custom-fields-admin';

export const dynamic = 'force-dynamic';

export default async function AdminCustomFieldsPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const session = await requireAdmin();
  const sp = await searchParams;
  const screen = await getCustomFieldsScreen(prisma, session, sp.entity);

  return (
    <CustomFieldsAdmin
      entity={screen.entity}
      definitions={screen.definitions}
      systemFields={screen.systemFields}
      basePath="/admin/custom-fields"
    />
  );
}
