import React from 'react';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listDefinitions } from '@/lib/services/customFields';
import { CustomFieldsAdmin } from '@/components/admin/custom-fields-admin';

export const dynamic = 'force-dynamic';

export default async function AdminCustomFieldsPage() {
  const session = await requireAdmin();
  const res = await listDefinitions(prisma, session, 'order');
  const definitions = res.ok ? res.rows : [];

  return <CustomFieldsAdmin definitions={definitions} />;
}
