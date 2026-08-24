import React from 'react';
import type { PrismaClient } from '@prisma/client';
import { listMembers } from '@/lib/services/organization/team';
import { InviteCustomerAdminForm } from './invite-customer-admin-form';

type Props = {
  organizationId: string;
  prisma: PrismaClient;
  /** When false the invite button is hidden — read-only view for partner-managers. */
  canInvite: boolean;
  /**
   * Which server action backs the invite button. 'partner' is enforced by the
   * partner-portfolio scope check; 'admin' allows any organisation.
   */
  source?: 'partner' | 'admin';
};

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export async function CustomerAccessSection({
  organizationId,
  prisma,
  canInvite,
  source = 'partner',
}: Props) {
  const members = await listMembers(prisma, organizationId);
  const activeAdmins = members.filter((m) => m.isActive && m.roleInOrg === 'admin');
  const hasActiveAdmin = activeAdmins.length > 0;

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-base font-semibold text-[#111111]">Доступ в кабинет</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Кто из сотрудников заказчика может зайти в личный кабинет организации.
          </p>
        </div>
        {canInvite && (
          <InviteCustomerAdminForm
            organizationId={organizationId}
            source={source}
            label={hasActiveAdmin ? 'Пригласить ещё' : 'Пригласить администратора'}
          />
        )}
      </div>

      {hasActiveAdmin ? (
        <ul className="divide-y divide-gray-100 -mx-5">
          {activeAdmins.map((m) => (
            <li
              key={m.organizationUserId}
              className="flex items-center justify-between px-5 py-2 text-sm"
            >
              <div>
                <span className="font-medium text-[#111111]">{m.name}</span>
                <span className="text-gray-500 ml-2">{m.email}</span>
              </div>
              <span className="text-xs text-gray-400">с {fmtDate(m.invitedAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded p-3">
          У этой организации пока нет активных администраторов кабинета.{' '}
          {canInvite
            ? 'Пригласите первого, чтобы клиент мог самостоятельно видеть свои заказы.'
            : 'Партнёр-администратор может пригласить первого через эту страницу.'}
        </div>
      )}
    </section>
  );
}
