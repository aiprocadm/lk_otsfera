import type { Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeDialog, dialogWhereForLevel } from '@/lib/auth/accessProfile';

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

/**
 * `У-214`: поверх границы компании действует ОХВАТ профиля доступа. Правило
 * наслоения прежнее (CLAUDE.md §2b): нет профиля или в нём стоит `all` —
 * поведение ровно такое, каким было до этапа 3.
 *
 * Обе функции ниже — тонкие обёртки над общим правилом
 * (`dialogWhereForLevel` / `canSeeDialog` в `lib/auth/accessProfile`): держать
 * саму логику здесь значило бы завести ВТОРОЕ место, где написано, кто что
 * видит, — а расходятся такие места молча.
 */

/** Prisma-форма скоупа (списки, счётчики). */
export function dialogScopeWhere(session: SessionPayload): Prisma.MessengerDialogWhereInput {
  return dialogWhereForLevel(session, session.accessProfile?.dialogs ?? 'all');
}

/** In-memory форма для уже загруженного диалога (карточка, действия). */
export function isDialogInScope(
  session: SessionPayload,
  dialog: { companyId: string | null; assigneeId?: string | null; organizationId?: string | null }
): boolean {
  return canSeeDialog(session, {
    companyId: dialog.companyId,
    assigneeId: dialog.assigneeId ?? null,
    organizationId: dialog.organizationId ?? null,
  });
}
