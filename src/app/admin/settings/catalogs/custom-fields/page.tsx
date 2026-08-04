import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { getCustomFieldsScreen } from '@/lib/services/customFields/screen';
import { CustomFieldsAdmin } from '@/components/admin/custom-fields-admin';

export const metadata: Metadata = { title: 'Дополнительные поля · Настройки' };

export const dynamic = 'force-dynamic';

export default async function AdminCustomFieldsPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const session = await requireSettingsSection('catalogs.customFields', 'admin');
  const sp = await searchParams;
  const screen = await getCustomFieldsScreen(prisma, session, sp.entity);

  return (
    <CustomFieldsAdmin
      entity={screen.entity}
      definitions={screen.definitions}
      systemFields={screen.systemFields}
      basePath="/admin/settings/catalogs/custom-fields"
    />
  );
}
