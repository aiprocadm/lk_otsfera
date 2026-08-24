import React from 'react';
import type { PrismaClient } from '@prisma/client';
import { listMembers } from '@/lib/services/organization/team';
import { TeamTable } from '@/components/organization/team-table';
import { InviteOrgUserForm } from '@/components/organization/invite-org-user-form';

/**
 * «Доступ в кабинет» на вкладке «Настройки» своей организации (`У-98`,
 * `У-100`).
 *
 * Это тот же экран, что раньше жил отдельным пунктом меню «Команда»: список
 * участников, приглашение, смена роли и деактивация. Переехал целиком, вместе
 * с правами — их по-прежнему проверяет серверное действие на каждую строку.
 *
 * Название и пояснение секции даёт реестр `orgSettingsSections`, поэтому
 * своего заголовка здесь нет.
 */
export async function OrgCabinetAccessSection({
  organizationId,
  prisma,
  currentUserId,
  viewerRole,
}: {
  organizationId: string;
  prisma: PrismaClient;
  currentUserId: string;
  viewerRole: 'admin' | 'leader' | 'member';
}) {
  const members = await listMembers(prisma, organizationId);
  const canManage = viewerRole === 'admin' || viewerRole === 'leader';

  return (
    <div>
      {canManage && (
        <div className="flex justify-end mb-3">
          <InviteOrgUserForm organizationId={organizationId} viewerRole={viewerRole} />
        </div>
      )}

      <TeamTable
        members={members}
        organizationId={organizationId}
        currentUserId={currentUserId}
        viewerRole={viewerRole}
      />

      <p className="text-xs text-gray-400 mt-2">
        Администраторы и руководители могут приглашать участников, менять роли и деактивировать
        доступ; роль «Администратор» назначают только администраторы. Последнего активного
        администратора деактивировать нельзя.
      </p>
    </div>
  );
}
