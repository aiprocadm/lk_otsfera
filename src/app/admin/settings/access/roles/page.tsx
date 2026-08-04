import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { listAccessProfiles, listAssignableUsers } from '@/lib/services/access/profiles';
import { RoleEditor } from '@/components/access/role-editor';

export const metadata: Metadata = { title: 'Роли и профили доступа · Настройки' };

export default async function AdminRolesPage() {
  const session = await requireSettingsSection('access.roles', 'admin');
  const [profilesRes, usersRes] = await Promise.all([
    listAccessProfiles(prisma, session),
    listAssignableUsers(prisma, session),
  ]);
  return (
    <RoleEditor
      profiles={profilesRes.ok ? profilesRes.rows : []}
      users={usersRes.ok ? usersRes.rows : []}
    />
  );
}
