import React from 'react';
import type { PrismaClient } from '@prisma/client';
import { listMembers } from '@/lib/services/organization/team';
import { TeamTable } from '@/components/organization/team-table';
import { InviteOrgUserForm } from '@/components/organization/invite-org-user-form';
import { OrgMemberScopeForm } from '@/components/organization/org-member-scope-form';
import { getOrgMemberScopeSetting } from '@/lib/services/organization/memberScope';

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
  const [members, membersSeeOwnOrdersOnly] = await Promise.all([
    listMembers(prisma, organizationId),
    // `У-236`: правило организации живёт рядом со списком участников — оно про них.
    getOrgMemberScopeSetting(prisma, organizationId),
  ]);
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

      <div className="mt-3 border-t border-gray-100 pt-3">
        <OrgMemberScopeForm
          organizationId={organizationId}
          value={membersSeeOwnOrdersOnly}
          canEdit={viewerRole === 'admin'}
        />
      </div>

      <p className="text-xs text-gray-400 mt-2">
        Администраторы и руководители могут приглашать участников, менять роли и деактивировать
        доступ; роль «Администратор» назначают только администраторы. Последнего активного
        администратора деактивировать нельзя.
      </p>
    </div>
  );
}
