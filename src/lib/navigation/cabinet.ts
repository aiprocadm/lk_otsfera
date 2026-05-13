import type { Role } from '@/lib/auth/jwt';

export type NavItem = { href: string; label: string };

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
  partner: [{ href: '/partner/dashboard', label: 'Dashboard партнера' }],
  organization: [
    { href: '/organization/dashboard', label: 'Dashboard организации' },
    { href: '/student', label: 'Кабинет слушателя' }
  ],
  student: [{ href: '/student', label: 'Обучение' }]
};
