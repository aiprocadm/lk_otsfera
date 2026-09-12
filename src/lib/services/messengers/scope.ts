import type { Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Скоуп диалогов мессенджеров (спека 2026-09-12, Р-М-3) — единственный
 * источник правды «какие диалоги сотрудник видит и может трогать».
 *
 * Зеркало `inbound/scope.ts`: свои — диалоги СВОЕЙ компании, плюс общая
 * очередь непривязанных (`companyId IS NULL`), и никогда чужой компании.
 * Страховка `'__no_company__'`: сессия без компании не должна совпасть со
 * всеми компаниями сразу (`companyId: undefined` снял бы фильтр целиком).
 *
 * ВАЖНО: `dialogScopeWhere` (Prisma) и `isDialogInScope` (in-memory) обязаны
 * означать одно и то же — меняются вместе; матрица эквивалентности живёт в
 * `src/__tests__/messengers.scope.unit.test.ts`.
 */

const NO_COMPANY_SENTINEL = '__no_company__';

/** Prisma-форма скоупа (списки, счётчики). */
export function dialogScopeWhere(session: SessionPayload): Prisma.MessengerDialogWhereInput {
  return {
    OR: [{ companyId: session.companyId ?? NO_COMPANY_SENTINEL }, { companyId: null }],
  };
}

/** In-memory форма для уже загруженного диалога (карточка, действия). */
export function isDialogInScope(
  session: SessionPayload,
  dialog: { companyId: string | null }
): boolean {
  return (
    dialog.companyId === null ||
    (session.companyId != null && dialog.companyId === session.companyId)
  );
}
