import type { Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  leadWhereForLevel,
  taskWhereForLevel,
  NO_COMPANY_SENTINEL
} from '@/lib/auth/accessProfile';
import {
  managedOrgIds,
  managerDocumentScope,
  managerOrderScope,
  managerOrgScope
} from '@/lib/auth/managerPolicy';
import { eventScopeWhere } from '@/lib/services/calendar/items';
import { conversationScopeWhere } from '@/lib/services/staffChat/conversations';

/**
 * M6 (спека 2026-07-18): where-построители категорий глобального поиска.
 * Инвариант «поиск видит ровно то, что домашний список раздела»: manager-ветки
 * переиспользуют существующие scope-швы, admin — company-floor (Model A внутри
 * своей компании, как staffGate G3/M5; лиды — вся командная очередь, у Lead нет
 * companyId). Единственный модуль поиска, различающий роли.
 */
export type SearchScopes = {
  orders: Prisma.OrderWhereInput;
  organizations: Prisma.OrganizationWhereInput;
  leads: Prisma.LeadWhereInput;
  tasks: Prisma.TaskWhereInput;
  events: Prisma.CalendarEventWhereInput;
  documents: Prisma.DocumentWhereInput;
  students: Prisma.StudentWhereInput;
  messages: Prisma.StaffMessageWhereInput;
};

export function searchScopes(session: SessionPayload, teamMode: boolean): SearchScopes {
  const floor = { companyId: session.companyId ?? NO_COMPANY_SENTINEL };
  const isAdmin = session.role === 'admin';
  return {
    orders: isAdmin ? floor : managerOrderScope(session, teamMode),
    organizations: isAdmin ? floor : managerOrgScope(session, teamMode),
    leads: isAdmin ? {} : leadWhereForLevel(session, session.accessProfile?.leads ?? 'all'),
    // taskWhereForLevel/eventScopeWhere/conversationScopeWhere сами несут
    // company-floor и admin-ветку — переиспользуем шов целиком.
    tasks: taskWhereForLevel(session, session.accessProfile?.tasks ?? 'all'),
    events: eventScopeWhere(session),
    documents: isAdmin
      ? { ...floor, scanStatus: { not: 'infected' } }
      : managerDocumentScope(session, teamMode),
    // Student не несёт companyId — скоупится через организацию (зеркало listStudents).
    students:
      isAdmin || teamMode
        ? { organization: floor }
        : { organizationId: { in: managedOrgIds(session) } },
    messages: { conversation: conversationScopeWhere(session) }
  };
}
