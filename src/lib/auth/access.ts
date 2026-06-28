import type { Role } from './jwt';

export const roleHome: Record<Role, string> = {
  admin: '/admin/dashboard',
  manager: '/manager/dashboard',
  partner: '/partner/dashboard',
  organization: '/organization/dashboard',
  student: '/student'
};

// Model A (ось 4 аудита согласованности ролей): каждый кабинетный префикс
// пускает ТОЛЬКО свою роль. Admin управляет всем через /admin/* зеркало +
// policy.ts (return true), а не входом в чужие кабинеты — добавлять admin сюда
// «чтобы посмотреть» = мёртвая дверь (page-гарды его всё равно бьют).
// Исключение — /student: намеренный shared-entry с жёстким серверным гейтом на
// выпуск bridge-токена (admin видит лендинг, но токен не получит).
export const protectedPrefixes: Record<string, Role[]> = {
  '/admin': ['admin'],
  '/manager': ['manager'],
  '/partner': ['partner'],
  '/organization': ['organization'],
  // /leader — кабинет руководителя: только role=manager; суб-роль managerRole='leader'
  // бьётся серверным гардом requireManagerLeader на layout (middleware суб-роль не режет).
  '/leader': ['manager'],
  '/student': ['student', 'organization', 'admin', 'manager']
};
