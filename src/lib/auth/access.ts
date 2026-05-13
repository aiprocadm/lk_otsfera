import type { Role } from './jwt';

export const roleHome: Record<Role, string> = {
  admin: '/organization/dashboard',
  manager: '/manager/dashboard',
  partner: '/partner/dashboard',
  organization: '/organization/dashboard',
  student: '/student'
};

export const protectedPrefixes: Record<string, Role[]> = {
  '/partner': ['partner', 'admin', 'manager'],
  '/organization': ['organization', 'admin', 'manager'],
  '/manager': ['manager', 'admin'],
  '/student': ['student', 'organization', 'admin', 'manager']
};
