import type { Role } from '@/lib/auth/jwt';
import { isFeatureEnabled, type FeatureFlag } from '@/lib/featureFlags';

export type NavItem = { href: string; label: string; disabled?: boolean; flag?: FeatureFlag; leaderOnly?: boolean };

export const navByRole: Record<Role, NavItem[]> = {
  admin: [
    { href: '/admin/dashboard', label: 'Dashboard' },
    { href: '/admin/orders', label: 'Orders' },
    { href: '/admin/documents', label: 'Documents' },
    { href: '/admin/messages', label: 'Messages' },
    { href: '/admin/commission-statements', label: 'Комиссии' },
    { href: '/admin/sync', label: 'Синхронизация' },
    { href: '/admin/health', label: 'Здоровье' }
  ],
  manager: [
    { href: '/manager/dashboard', label: 'Главная', flag: 'manager_cabinet' },
    { href: '/manager/orders', label: 'Заказы', flag: 'manager_cabinet' },
    { href: '/manager/organizations', label: 'Организации', flag: 'manager_cabinet' },
    { href: '/manager/documents', label: 'Документы', flag: 'manager_cabinet' },
    { href: '/manager/students', label: 'Сотрудники', flag: 'manager_cabinet' },
    { href: '/manager/messages', label: 'Сообщения', flag: 'manager_cabinet' },
    { href: '/manager/team', label: 'Команда', flag: 'manager_cabinet', leaderOnly: true }
  ],
  partner: [
    { href: '/partner/dashboard', label: 'Дашборд' },
    { href: '/partner/portfolio', label: 'Портфель' },
    { href: '/partner/deals', label: 'Сделки' },
    { href: '/partner/leads', label: 'Заявки', flag: 'partner_leads' },
    { href: '/partner/documents', label: 'Документы' },
    { href: '/partner/finance', label: 'Финансы' },
    { href: '/partner/team', label: 'Команда' },
    { href: '/partner/messages', label: 'Сообщения', flag: 'chat' }
  ],
  organization: [
    { href: '/organization/dashboard', label: 'Dashboard организации', flag: 'organization_cabinet' },
    { href: '/student', label: 'Кабинет слушателя' },
    { href: '/organization/messages', label: 'Сообщения', flag: 'chat' }
  ],
  student: [{ href: '/student', label: 'Обучение' }]
};

/**
 * Returns the static menu for a role minus items whose feature flag is off
 * and, for the manager role, items marked `leaderOnly` when the caller is not
 * a leader. The `isManagerLeader` option defaults to false so existing callers
 * that don't pass it simply hide leader-only items — that's the safe default.
 *
 * `navByRole` stays exported for tests and any caller that wants the raw
 * shape; `navItemsFor` is what the app shell renders.
 */
export function navItemsFor(role: Role, opts?: { isManagerLeader?: boolean }): NavItem[] {
  return navByRole[role].filter((item) => {
    if (item.flag && !isFeatureEnabled(item.flag)) return false;
    if (item.leaderOnly && !opts?.isManagerLeader) return false;
    return true;
  });
}
