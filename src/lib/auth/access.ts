import type { Role } from './jwt';

export const roleHome: Record<Role, string> = {
  admin: '/admin/dashboard',
  manager: '/manager/dashboard',
  partner: '/partner/dashboard',
  organization: '/organization/dashboard',
  student: '/student'
};

export const protectedPrefixes: Record<string, Role[]> = {
  '/admin': ['admin'],
  '/manager': ['manager'],
  '/partner': ['partner', 'admin'],
  '/organization': ['organization', 'admin'],
  '/student': ['student', 'organization', 'admin', 'manager']
};
