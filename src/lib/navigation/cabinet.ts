import type { Role } from '@/lib/auth/jwt';
import { isFeatureEnabled, type FeatureFlag } from '@/lib/featureFlags';

export type NavItem = { href: string; label: string; disabled?: boolean; flag?: FeatureFlag };

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
    { href: '/manager/dashboard', label: 'Dashboard' },
    { href: '/manager/orders', label: 'Orders' },
    { href: '/manager/documents', label: 'Documents' },
    { href: '/manager/messages', label: 'Messages' }
  ],
  partner: [
    { href: '/partner/dashboard', label: 'Дашборд' },
    { href: '/partner/portfolio', label: 'Портфель' },
    { href: '/partner/deals', label: 'Сделки' },
    { href: '/partner/leads', label: 'Заявки', flag: 'partner_leads' },
    { href: '/partner/documents', label: 'Документы' },
    { href: '/partner/finance', label: 'Финансы' },
    { href: '/partner/team', label: 'Команда' }
  ],
  organization: [
    { href: '/organization/dashboard', label: 'Dashboard организации' },
    { href: '/student', label: 'Кабинет слушателя' }
  ],
  student: [{ href: '/student', label: 'Обучение' }]
};

/**
 * Returns the static menu for a role minus items whose feature flag is off.
 * `navByRole` stays exported for tests and any caller that wants the raw
 * shape; `navItemsFor` is what the app shell renders.
 */
export function navItemsFor(role: Role): NavItem[] {
  return navByRole[role].filter((item) => !item.flag || isFeatureEnabled(item.flag));
}
