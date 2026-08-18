import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Базовые предикаты ролевой модели (программа «роль Руководитель»,
 * ТЗ 2026-08-17). Отдельный модуль без зависимостей, кроме типов jwt:
 * его импортируют и managerPolicy (реэкспортирует наружу), и модули НИЖЕ
 * managerPolicy в графе (accessProfile, documentChannelPolicy) — прямой
 * импорт managerPolicy оттуда дал бы цикл (dependency-cruiser его ловит).
 */

/**
 * «Это руководитель?» — top-level роль `leader` (программа ТЗ 2026-08-17
 * закрыта PR-4: переходная пара manager+managerRole снята вместе с колонкой,
 * все сессии руководителей ревокнуты миграцией). Имя историческое — у
 * предиката ~36 вызовов.
 */
export function isManagerLeader(session: SessionPayload): boolean {
  return session.role === 'leader';
}

/**
 * «Сотрудник менеджерского контура?» (Р-Л-4, шаблон 1): рядовой менеджер ИЛИ
 * руководитель — в любой из двух моделей. Единая точка для мест вида
 * `role === 'manager'`, где смысл — контур, а не именно рядовой: без хелпера
 * ~99 таких мест при выделении роли разбирались бы по одному и часть — неверно.
 */
export function isStaffManagerSide(session: SessionPayload): boolean {
  return session.role === 'manager' || session.role === 'leader';
}
