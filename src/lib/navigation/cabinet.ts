import type { Role } from '@/lib/auth/jwt';
import { isFeatureEnabled, type FeatureFlag } from '@/lib/featureFlags';

export type NavItem = {
  href: string;
  label: string;
  disabled?: boolean;
  flag?: FeatureFlag;
  leaderOnly?: boolean;
  partnerAdminOnly?: boolean;
  /** Иконка для org-sidebar (emoji). Прочие шеллы её игнорируют. */
  icon?: string;
  /** Виден только org-admin и org-leader (фильтруется в OrgSidebar по viewerRole, НЕ в navItemsFor). */
  orgAdminOrLeaderOnly?: boolean;
};

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
    { href: '/partner/team', label: 'Команда', partnerAdminOnly: true },
    { href: '/partner/messages', label: 'Сообщения', flag: 'chat' }
  ],
  organization: [
    { href: '/organization/dashboard', label: 'Главная', icon: '⌂' },
    { href: '/organization/orders', label: 'Заказы', icon: '📋' },
    { href: '/organization/documents', label: 'Документы', icon: '📄' },
    { href: '/organization/finance', label: 'Финансы', icon: '₽' },
    { href: '/organization/students', label: 'Сотрудники', icon: '👥' },
    { href: '/organization/team', label: 'Команда', icon: '⚙', orgAdminOrLeaderOnly: true },
    { href: '/organization/messages', label: 'Сообщения', icon: '💬', flag: 'chat' },
    { href: '/student', label: 'Кабинет слушателя', icon: '🎓' }
  ],
  student: [{ href: '/student', label: 'Обучение' }]
};

/**
 * Returns the static menu for a role minus items whose feature flag is off,
 * items marked `leaderOnly` when the caller is not a manager-leader, and items
 * marked `partnerAdminOnly` when the caller is not a partner-admin. Both
 * `isManagerLeader` and `isPartnerAdmin` default to false, so callers that
 * don't pass them simply hide the elevated items — that's the safe default.
 *
 * `navByRole` stays exported for tests and any caller that wants the raw
 * shape; `navItemsFor` is what the app shell renders.
 */
export function navItemsFor(
  role: Role,
  opts?: { isManagerLeader?: boolean; isPartnerAdmin?: boolean }
): NavItem[] {
  return navByRole[role].filter((item) => {
    if (item.flag && !isFeatureEnabled(item.flag)) return false;
    if (item.leaderOnly && !opts?.isManagerLeader) return false;
    if (item.partnerAdminOnly && !opts?.isPartnerAdmin) return false;
    return true;
  });
}
