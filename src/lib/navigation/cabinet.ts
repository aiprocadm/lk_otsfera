import type { Role } from '@/lib/auth/jwt';

export type NavItem = { href: string; label: string; disabled?: boolean };

export const navByRole: Record<Role, NavItem[]> = {
  admin: [
    { href: '/admin/dashboard', label: 'Dashboard' },
    { href: '/admin/orders', label: 'Orders' },
    { href: '/admin/documents', label: 'Documents' },
    { href: '/admin/messages', label: 'Messages' }
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
    { href: '/partner/leads', label: 'Заявки', disabled: true },
    { href: '/partner/documents', label: 'Документы', disabled: true },
    { href: '/partner/finance', label: 'Финансы', disabled: true },
    { href: '/partner/team', label: 'Команда' }
  ],
  organization: [
    { href: '/organization/dashboard', label: 'Dashboard организации' },
    { href: '/student', label: 'Кабинет слушателя' }
  ],
  student: [{ href: '/student', label: 'Обучение' }]
};
