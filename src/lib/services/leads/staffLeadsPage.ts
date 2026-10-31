import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { isLeadStatus } from '@/lib/leads/statuses';
import { getFunnelBoard, type FunnelBoard } from '@/lib/services/funnel/board';
import { listManagerLeads, type ListManagerLeadsResult } from '@/lib/services/manager/leads';
import { listCompanyOrgOptions, type CompanyOrgOption } from '@/lib/services/manager/organizations';

/**
 * Данные экрана «Лиды» — один загрузчик на кабинеты менеджера и руководителя
 * (этап 4 ТЗ 28.10.2026, `У-349`, правило зеркала §0.2): раньше у руководителя
 * «Лидов» не было, а воронка жила отдельным разделом.
 *
 * Список и воронка видят лиды в одном охвате: оба получают сессию, и профиль
 * доступа (`leads`: own/assigned/all) режет обе выборки. До этапа страница
 * менеджера звала `listManagerLeads` без сессии — список показывал всю очередь
 * даже тем, кому профиль разрешал только свои лиды (API и воронка охват
 * соблюдали).
 */

export type StaffLeadsSearchParams = {
  status?: string | undefined;
  q?: string | undefined;
  assignedToMe?: string | undefined;
  cursor?: string | undefined;
  /** `funnel` — воронка по стадиям вместо списка (`У-312`). */
  view?: string | undefined;
};

export type StaffLeadsPageData = {
  /** Флаг `sales_funnel`: выключен — переключателя нет, `?view=funnel` даёт список. */
  funnelEnabled: boolean;
  list: ListManagerLeadsResult | null;
  board: FunnelBoard | null;
  /** Организации компании для необязательной привязки нового лида (C8). */
  organizations: CompanyOrgOption[];
};

export async function loadStaffLeadsPage(
  prisma: PrismaClient,
  session: SessionPayload,
  sp: StaffLeadsSearchParams
): Promise<StaffLeadsPageData> {
  const funnelEnabled = isFeatureEnabled('sales_funnel');
  const funnel = funnelEnabled && sp.view === 'funnel';
  const status = sp.status && isLeadStatus(sp.status) ? sp.status : undefined;

  const [list, board, organizations] = await Promise.all([
    funnel
      ? null
      : listManagerLeads(prisma, {
          session,
          status,
          search: sp.q,
          assignedToUserId: sp.assignedToMe === '1' ? session.sub : undefined,
          cursor: sp.cursor,
        }),
    funnel ? getFunnelBoard(prisma, session) : null,
    listCompanyOrgOptions(prisma, session),
  ]);
  return { funnelEnabled, list, board, organizations };
}
