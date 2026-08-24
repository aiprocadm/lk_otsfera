import React from 'react';
import type { PrismaClient } from '@prisma/client';
import { listManagersForOrg } from '@/lib/services/manager/team';
import {
  deactivateManagerAssignmentFormAction,
  reactivateManagerAssignmentFormAction,
} from '@/server-actions/admin/manager';
import { AssignOrInviteManagerForm } from './assign-or-invite-manager-form';

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export async function ManagersBlock({
  orgId,
  prisma,
  canManage = true,
}: {
  orgId: string;
  prisma: PrismaClient;
  /**
   * `У-99`: состав менеджеров видят все сотрудники ЦО, а назначать и снимать
   * их по-прежнему может только администратор. ТЗ расширяет права только по
   * ставке комиссии (`admin`/`leader`) — трогать назначения оно не просило,
   * поэтому право не расширяем «заодно».
   */
  canManage?: boolean;
}) {
  const { active, inactive } = await listManagersForOrg(prisma, orgId);
  const hasAny = active.length + inactive.length > 0;

  return (
    <div>
      {/* Название и пояснение секции дают реестр `orgSettingsSections` и рамка
          `OrgSettingsTab` — здесь только тело. */}
      {canManage && (
        <div className="flex justify-end mb-3">
          <AssignOrInviteManagerForm organizationId={orgId} />
        </div>
      )}

      {!hasAny && (
        <div className="text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded p-3">
          У этой организации пока нет назначенных менеджеров.
        </div>
      )}

      {active.length > 0 && (
        <ul className="divide-y divide-gray-100 -mx-5">
          {active.map((a) => (
            <li key={a.id} className="flex items-center justify-between px-5 py-2 text-sm">
              <div>
                <span className="font-medium text-[#111111]">{a.user.name ?? '—'}</span>
                <span className="text-gray-500 ml-2">{a.user.email}</span>
                <span className="text-xs text-gray-400 ml-2">с {fmtDate(a.assignedAt)}</span>
              </div>
              {canManage && (
                <form action={deactivateManagerAssignmentFormAction}>
                  <input type="hidden" name="assignmentId" value={a.id} />
                  <button
                    type="submit"
                    className="text-xs text-red-600 hover:text-red-700 hover:underline"
                  >
                    Деактивировать
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {inactive.length > 0 && (
        <>
          <h3 className="text-xs uppercase tracking-wide text-gray-400 mt-4 mb-1">Архив</h3>
          <ul className="divide-y divide-gray-100 -mx-5">
            {inactive.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between px-5 py-2 text-sm opacity-60"
              >
                <div>
                  <span className="font-medium text-[#111111]">{a.user.name ?? '—'}</span>
                  <span className="text-gray-500 ml-2">{a.user.email}</span>
                  {a.deactivatedAt && (
                    <span className="text-xs text-gray-400 ml-2">
                      деактивирован {fmtDate(a.deactivatedAt)}
                    </span>
                  )}
                </div>
                {canManage && (
                  <form action={reactivateManagerAssignmentFormAction}>
                    <input type="hidden" name="assignmentId" value={a.id} />
                    <button
                      type="submit"
                      className="text-xs text-[#F97316] hover:text-[#EA580C] hover:underline"
                    >
                      Возобновить
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
