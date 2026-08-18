import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Базовые предикаты ролевой модели (программа «роль Руководитель»,
 * ТЗ 2026-08-17). Отдельный модуль без зависимостей, кроме типов jwt:
 * его импортируют и managerPolicy (реэкспортирует наружу), и модули НИЖЕ
 * managerPolicy в графе (accessProfile, documentChannelPolicy) — прямой
 * импорт managerPolicy оттуда дал бы цикл (dependency-cruiser его ловит).
 */

/**
 * «Это руководитель?» — понимает ОБЕ модели (Р-Л-2): новую top-level роль
 * `leader` и переходную пару `manager + managerRole='leader'` (токены живут
 * 7 дней после миграции данных в PR-3). Старая половина условия снимается
 * PR-4 вместе с колонкой `managerRole`.
 */
export function isManagerLeader(session: SessionPayload): boolean {
  return (
    session.role === 'leader' ||
    (session.role === 'manager' && session.managerRole === 'leader')
  );
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
