import type { Role } from './jwt';

export const roleHome: Record<Role, string> = {
  admin: '/admin/dashboard',
  manager: '/manager/dashboard',
  // Дом руководителя при ВЫКЛЮЧЕННОМ leader_cabinet выбирает middleware
  // (падает на /manager/dashboard) — здесь только дефолт включённого флага.
  leader: '/leader/dashboard',
  partner: '/partner/dashboard',
  organization: '/organization/dashboard',
  student: '/student',
};

// Model A (ось 4 аудита согласованности ролей): каждый кабинетный префикс
// пускает ТОЛЬКО свою роль. Admin управляет всем через /admin/* зеркало +
// policy.ts (return true), а не входом в чужие кабинеты — добавлять admin сюда
// «чтобы посмотреть» = мёртвая дверь (page-гарды его всё равно бьют).
// Исключение — /student: намеренный shared-entry с жёстким серверным гейтом на
// выпуск bridge-токена (admin видит лендинг, но токен не получит).
export const protectedPrefixes: Record<string, Role[]> = {
  '/admin': ['admin'],
  // «Играющий тренер» (Р-Л-3 ТЗ 2026-08-17): кабинет менеджера открыт и роли
  // leader — руководитель работает в обоих кабинетах, как и раньше.
  '/manager': ['manager', 'leader'],
  '/partner': ['partner'],
  '/organization': ['organization'],
  // /leader: до PR-4 пускает и role=manager — старые токены руководителя несут
  // её (пара manager+managerRole бьётся серверным гардом requireManagerLeader
  // на layout, middleware суб-роль не режет). После снятия лесов — ['leader'].
  '/leader': ['manager', 'leader'],
  '/student': ['student', 'organization', 'admin', 'manager', 'leader'],
};
