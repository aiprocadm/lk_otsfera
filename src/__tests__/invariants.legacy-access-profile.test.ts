import { describe, it, expect } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  managerOrderScope,
  managerDocumentScope,
  managerOrgScope,
  canSeeOrder,
} from '@/lib/auth/managerPolicy';
import {
  can,
  canSeeLead,
  canSeeTask,
  leadWhereForLevel,
  taskWhereForLevel,
  NO_COMPANY_SENTINEL,
} from '@/lib/auth/accessProfile';
import { taskFiltersWhere } from '@/lib/services/tasks/board';

/**
 * Инвариант #7 (фаза 6, «исполняемое ТЗ») — accessProfileId = null → LEGACY-
 * ПОВЕДЕНИЕ БАЙТ-В-БАЙТ (трек G1, «наслоение»: профиль — override, его
 * отсутствие обязано давать старые правила teamMode без малейшего дрейфа).
 *
 * Для каждого резолвера выход сессии БЕЗ профиля сравнивается с ЭТАЛОННЫМ
 * legacy-выражением, выписанным здесь литералом (не вызовом той же функции —
 * иначе тест был бы тавтологией):
 *  - managerOrderScope:    OFF → 3-way OR (managerId ∪ managedOrgIds ∪
 *                          исторические комментарии); ON → { companyId }.
 *  - managerDocumentScope: тот же order-where + scanStatus != infected.
 *  - managerOrgScope:      OFF → { id in managedOrgIds }; ON → { companyId }.
 *  - canSeeOrder:          полная таблица истинности legacy-предиката.
 *  - лиды:                 нет профиля ⇔ team-wide (эквивалент уровня 'all',
 *                          который для лидов — пустой where без company-floor).
 *  - задачи:               нет профиля ⇔ company-wide ('all' с company-floor).
 *  - can('see_commission'): нет профиля ⇔ старое leader-правило
 *                          (admin ∨ (manager ∧ managerRole='leader')).
 * Разворот любой «нет профиля»-ветки в сторону расширения или сужения
 * видимости роняет этот тест (см. мутационную проверку фазы 6).
 */

const SUB = 'u-legacy';
const COMPANY = 'c-legacy';
const ORGS = ['org-1', 'org-2'];

function session(over: Partial<SessionPayload> = {}): SessionPayload {
  return {
    sub: SUB,
    role: 'manager',
    companyId: COMPANY,
    managedOrgIds: ORGS,
    accessProfile: null, // суть инварианта: профиля НЕТ
    ...over,
  } as SessionPayload;
}

// ── Эталонные legacy-выражения (литералы, не вызовы продовых функций) ────────
const LEGACY_SCOPED_ORDER_WHERE = {
  OR: [
    { managerId: SUB },
    { organizationId: { in: ORGS } },
    { comments: { some: { authorId: SUB } } },
  ],
};
const LEGACY_TEAM_ORDER_WHERE = { companyId: COMPANY };

describe('Инвариант: без профиля managerOrderScope — это старые правила teamMode байт-в-байт', () => {
  it('teamMode=OFF → персональный 3-way OR (свои заказы ∪ закреплённые орги ∪ история комментариев)', () => {
    expect(managerOrderScope(session(), false)).toEqual(LEGACY_SCOPED_ORDER_WHERE);
  });

  it('teamMode=ON → вся компания и только компания', () => {
    expect(managerOrderScope(session(), true)).toEqual(LEGACY_TEAM_ORDER_WHERE);
  });

  it('teamMode=ON без companyId → sentinel (deny-all, а не «видно всё»)', () => {
    expect(managerOrderScope(session({ companyId: null }), true)).toEqual({
      companyId: NO_COMPANY_SENTINEL,
    });
  });
});

describe('Инвариант: без профиля managerDocumentScope = legacy order-where + фильтр заражённых', () => {
  it('teamMode=OFF', () => {
    expect(managerDocumentScope(session(), false)).toEqual({
      order: LEGACY_SCOPED_ORDER_WHERE,
      scanStatus: { not: 'infected' },
    });
  });

  it('teamMode=ON', () => {
    expect(managerDocumentScope(session(), true)).toEqual({
      order: LEGACY_TEAM_ORDER_WHERE,
      scanStatus: { not: 'infected' },
    });
  });
});

describe('Инвариант: без профиля managerOrgScope = legacy-скоуп организаций', () => {
  it('teamMode=OFF → только закреплённые организации', () => {
    expect(managerOrgScope(session(), false)).toEqual({ id: { in: ORGS } });
  });

  it('teamMode=ON → организации своей компании', () => {
    expect(managerOrgScope(session(), true)).toEqual({ companyId: COMPANY });
  });
});

describe('Инвариант: без профиля canSeeOrder воспроизводит legacy-предикат по всей таблице истинности', () => {
  // Эталон — legacy-правило, выписанное независимо от прода:
  //   teamMode=ON  → видит ⇔ заказ своей компании;
  //   teamMode=OFF → видит ⇔ свой managerId ∨ закреплённая орга ∨ сам комментировал.
  function legacyReference(
    order: {
      managerId: string | null;
      organizationId: string | null;
      companyId: string | null;
      commentsCountByMe: number;
    },
    teamMode: boolean
  ): boolean {
    if (teamMode) return order.companyId === COMPANY;
    return (
      order.managerId === SUB ||
      (order.organizationId !== null && ORGS.includes(order.organizationId)) ||
      order.commentsCountByMe > 0
    );
  }

  const managerIds = [SUB, 'u-other', null];
  const orgIds = ['org-1', 'org-foreign', null];
  const companyIds = [COMPANY, 'c-foreign', null];
  const commentCounts = [0, 2];

  it('все 3×3×3×2×2 = 108 комбинаций совпадают с эталоном', () => {
    for (const teamMode of [false, true]) {
      for (const managerId of managerIds) {
        for (const organizationId of orgIds) {
          for (const companyId of companyIds) {
            for (const commentsCountByMe of commentCounts) {
              const order = { managerId, organizationId, companyId, commentsCountByMe };
              expect(
                canSeeOrder(session(), order, teamMode),
                `расхождение с legacy: ${JSON.stringify({ ...order, teamMode })}`
              ).toBe(legacyReference(order, teamMode));
            }
          }
        }
      }
    }
  });
});

describe('Инвариант: без профиля лиды — team-wide (командная очередь без фильтра)', () => {
  it('canSeeLead без профиля видит любой лид (свой, чужой, ничейный)', () => {
    const s = session();
    expect(canSeeLead(s, { assignedManagerId: SUB, organizationId: null })).toBe(true);
    expect(canSeeLead(s, { assignedManagerId: 'u-other', organizationId: 'org-foreign' })).toBe(
      true
    );
    expect(canSeeLead(s, { assignedManagerId: null, organizationId: null })).toBe(true);
  });

  it("уровень 'all' для лидов — пустой where: «нет профиля» и «all» тождественны", () => {
    // У лида нет companyId (single-tenant очередь) — company-floor не применяется.
    expect(leadWhereForLevel(session(), 'all')).toEqual({});
  });
});

describe('Инвариант: без профиля задачи — company-wide (call-site «?? all» + company-floor)', () => {
  it("where доски задач без профиля = taskWhereForLevel 'all' = только company-floor", () => {
    const now = new Date();
    expect(taskFiltersWhere(session(), undefined, now)).toEqual({ companyId: COMPANY });
    expect(taskFiltersWhere(session(), undefined, now)).toEqual(
      taskWhereForLevel(session(), 'all')
    );
  });

  it('сессия без companyId → sentinel (deny-all, а не вся база задач)', () => {
    expect(taskFiltersWhere(session({ companyId: null }), undefined, new Date())).toEqual({
      companyId: NO_COMPANY_SENTINEL,
    });
  });

  it('canSeeTask без профиля: любая задача своей компании видна, чужой — нет', () => {
    const foreignersTask = {
      companyId: COMPANY,
      createdById: 'u-other',
      assigneeUserIds: ['u-other-2'],
      linkedOrganizationId: 'org-foreign',
    };
    expect(canSeeTask(session(), foreignersTask)).toBe(true); // company-wide legacy
    expect(canSeeTask(session(), { ...foreignersTask, companyId: 'c-foreign' })).toBe(false);
  });
});

describe("Инвариант: без профиля can('see_commission') == leader-правило", () => {
  it('admin → true; manager-leader → true; рядовой manager → false; клиентские роли → false', () => {
    expect(can(session({ role: 'admin' }), 'see_commission')).toBe(true);
    expect(can(session({ managerRole: 'leader' }), 'see_commission')).toBe(true);
    expect(can(session(), 'see_commission')).toBe(false);
    expect(can(session({ role: 'partner' }), 'see_commission')).toBe(false);
    expect(can(session({ role: 'organization' }), 'see_commission')).toBe(false);
    expect(can(session({ role: 'student' }), 'see_commission')).toBe(false);
  });

  it('прочие capability без профиля ни к кому не привязаны (deny даже для leader), admin — выше правил', () => {
    for (const cap of [
      'import_1c',
      'export',
      'manage_catalog',
      'manage_users',
      'assign_orders',
    ] as const) {
      expect(can(session({ managerRole: 'leader' }), cap)).toBe(false);
      expect(can(session(), cap)).toBe(false);
      expect(can(session({ role: 'admin' }), cap)).toBe(true);
    }
  });
});
