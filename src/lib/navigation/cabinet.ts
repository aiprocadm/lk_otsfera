import type { Role } from '@/lib/auth/jwt';

export type NavItem = { href: string; label: string };

export const navByRole: Record<Role, NavItem[]> = {
  admin: [
    { href: '/organization/dashboard', label: 'Организации' },
    { href: '/partner/dashboard', label: 'Партнеры' },
    { href: '/student', label: 'Слушатель' }
  ],
  manager: [
    { href: '/organization/dashboard', label: 'Организации' },
    { href: '/partner/dashboard', label: 'Партнеры' },
    { href: '/student', label: 'Слушатель' }
  ],
  partner: [
    { href: '/partner/dashboard', label: 'Dashboard партнера' }
  ],
  organization: [
    { href: '/organization/dashboard', label: 'Dashboard организации' },
    { href: '/student', label: 'Кабинет слушателя' }
  ],
  student: [{ href: '/student', label: 'Обучение' }]
};
