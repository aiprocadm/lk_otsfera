import React from 'react';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listAccessProfiles, listAssignableUsers } from '@/lib/services/access/profiles';
import { RoleEditor } from '@/components/access/role-editor';

export default async function AdminRolesPage() {
  if (!isFeatureEnabled('role_constructor')) notFound();
  const session = await requireAdmin();
  const [profilesRes, usersRes] = await Promise.all([
    listAccessProfiles(prisma, session),
    listAssignableUsers(prisma, session)
  ]);
  return (
    <RoleEditor
      profiles={profilesRes.ok ? profilesRes.rows : []}
      users={usersRes.ok ? usersRes.rows : []}
    />
  );
}
