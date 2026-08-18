import type { PrismaClient } from '@prisma/client';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrgScope } from '@/lib/auth/managerPolicy';

/**
 * Права на справочник сотрудников (`У-32`, этап 5 ТЗ понятности).
 *
 * **Проверка живёт здесь, в сервисе, а не в компоненте** (CLAUDE.md §4):
 * скрытая кнопка — это внешний вид, а не защита. Каждая роль отвечает на один
 * вопрос: «эта организация — моя?».
 *
 * | Роль | Читает | Пишет |
 * |---|---|---|
 * | `admin` | всё | всё |
 * | `organization` | своя организация (активное членство) | членство `admin`/`leader` |
 * | `partner` | организации своего портфеля | они же (`У-25`: любой партнёрский пользователь с доступом) |
 * | `manager` / руководитель | по `managerOrgScope` (mode-aware) | там же |
 *
 * `teamMode` — **обязательный** аргумент для менеджерских сессий: пропуск
 * молча сужает скоуп и не ловится typecheck'ом (предупреждение CLAUDE.md §4).
 * Вызывающий берёт его из `getCompanyTeamVisibility`.
 */
export type StudentAccess = { canRead: boolean; canWrite: boolean };

const DENY: StudentAccess = { canRead: false, canWrite: false };

export async function studentOrgAccess(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string,
  teamMode: boolean
): Promise<StudentAccess> {
  if (session.role === 'admin') return { canRead: true, canWrite: true };

  if (session.role === 'organization') {
    const m = (session.organizationMemberships ?? []).find(
      (x) => x.isActive && x.organizationId === orgId
    );
    if (!m) return DENY;
    return { canRead: true, canWrite: m.roleInOrg === 'admin' || m.roleInOrg === 'leader' };
  }

  if (session.role === 'partner') {
    if (!session.partnerId) return DENY;
    // Принадлежность портфелю проверяем по БД, а не по сессии: список
    // организаций в токене устаревает, привязка к партнёру — нет.
    const org = await prisma.organization.findFirst({
      where: { id: orgId, partnerId: session.partnerId },
      select: { id: true },
    });
    if (!org) return DENY;
    const scope = session.assignedOrgIds ?? [];
    if (scope.length > 0 && !scope.includes(orgId)) return DENY;
    return { canRead: true, canWrite: true };
  }

  if (isStaffManagerSide(session)) {
    const org = await prisma.organization.findFirst({
      where: { AND: [{ id: orgId }, managerOrgScope(session, teamMode)] },
      select: { id: true },
    });
    return org ? { canRead: true, canWrite: true } : DENY;
  }

  return DENY;
}
