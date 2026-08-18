import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Инвариант #6 (фаза 6, «исполняемое ТЗ») — гейт see_commission по АКТИВНОЙ
 * роли сессии (мультироль партнёр/организация, C2 §3.5/§21).
 *
 * Один и тот же человек может быть и партнёром (со ставкой), и сотрудником
 * организации. Решает не «кем он является», а «в каком контексте вошёл»:
 *  - партнёрская сессия (role='partner') комиссию ВИДИТ (finance-роут отдаёт
 *    KPI и ведомости);
 *  - организационная сессия ТОГО ЖЕ человека (role='organization', с тем же
 *    partnerId в клеймах) комиссию НЕ видит совсем — 403 до обращения к
 *    сервисам, ни одного комиссионного поля в ответе. Причина: экран кабинета
 *    организации можно показывать работодателю.
 *
 * Второй ярус того же инварианта — capability `can('see_commission')`
 * (accessProfile.ts) для staff-контура: решение тоже по активной роли/профилю
 * сессии, а не по совокупности идентичностей человека.
 *
 * Якоря: c2.multirole-commission.test.ts (точечный регресс guard'ов),
 * c1.commission-hiding.contract.test.ts (статический контракт org-контура).
 * Этот тест — исполняемая формулировка требования, падает при развороте гейта
 * (см. мутационную проверку в отчёте фазы 6).
 */

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/services/partner/finance', () => ({
  getFinanceKpis: vi.fn(),
  listStatements: vi.fn(),
  getStatementWithItems: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { getFinanceKpis, listStatements } from '@/lib/services/partner/finance';
import { GET as financeGET } from '@/app/api/partner/finance/route';
import { can } from '@/lib/auth/accessProfile';
import type { SessionPayload } from '@/lib/auth/jwt';
import type { SessionAccessProfile } from '@/lib/auth/accessProfileSchema';

// Один человек (sub одинаковый), две активные роли.
const HUMAN = 'u-multi-invariant';

const partnerContext = {
  sub: HUMAN,
  role: 'partner',
  partnerId: 'p-1',
  partnerRole: 'admin',
  organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'admin', isActive: true }],
} as unknown as SessionPayload;

const orgContext = {
  sub: HUMAN,
  role: 'organization',
  organizationId: 'org-1',
  organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'admin', isActive: true }],
  partnerId: 'p-1', // тот же человек всё ещё партнёр…
  partnerRole: 'admin', // …и даже партнёр-админ — но активный контекст решает
} as unknown as SessionPayload;

function managerSession(over: Partial<SessionPayload> = {}): SessionPayload {
  return { sub: HUMAN, role: 'manager', companyId: 'c-1', ...over } as SessionPayload;
}

function profile(capabilities: SessionAccessProfile['capabilities']): SessionAccessProfile {
  return {
    id: 'ap-1',
    name: 'Профиль',
    orders: 'all',
    organizations: 'all',
    threads: 'all',
    documents: 'all',
    finance: 'all',
    leads: 'all',
    tasks: 'all',
    capabilities,
  };
}

describe('Инвариант: комиссию видит партнёрская сессия и НЕ видит организационная сессия того же человека', () => {
  beforeEach(() => vi.resetAllMocks());

  it('партнёрская сессия: GET /api/partner/finance → 200, комиссионные KPI и ведомости отдаются', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerContext);
    vi.mocked(getFinanceKpis).mockResolvedValue({
      totalCommissionAmount: '1500.00',
      averageRate: '0.1000',
    } as unknown as Awaited<ReturnType<typeof getFinanceKpis>>);
    vi.mocked(listStatements).mockResolvedValue(
      [] as unknown as Awaited<ReturnType<typeof listStatements>>
    );

    const res = await financeGET(new Request('http://x/'));
    expect(res.status).toBe(200);
    // Комиссия считается ИМЕННО для партнёрской идентичности активной сессии.
    expect(getFinanceKpis).toHaveBeenCalledWith(expect.anything(), 'p-1');
    expect(listStatements).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ partnerId: 'p-1' })
    );
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('1500.00');
  });

  it('организационная сессия ТОГО ЖЕ человека: 403, комиссионные сервисы не вызываются', async () => {
    vi.mocked(getSession).mockResolvedValue(orgContext);
    const res = await financeGET(new Request('http://x/'));
    expect(res.status).toBe(403);
    expect(getFinanceKpis).not.toHaveBeenCalled();
    expect(listStatements).not.toHaveBeenCalled();
  });

  it('в 403-ответе организационной сессии нет ни одного комиссионного поля', async () => {
    vi.mocked(getSession).mockResolvedValue(orgContext);
    const res = await financeGET(new Request('http://x/'));
    const serialized = JSON.stringify(await res.json()).toLowerCase();
    expect(serialized).not.toContain('commission');
    expect(serialized).not.toContain('rate');
    expect(serialized).not.toContain('kpi');
  });

  it('гейт решает активная роль, а не совокупность идентичностей: requirePartner ok только в партнёрском контексте', () => {
    expect(requirePartner(partnerContext).ok).toBe(true);
    expect(requirePartner(orgContext).ok).toBe(false);
  });
});

describe('Инвариант: can(see_commission) в staff-контуре — тоже по активной сессии, не по человеку', () => {
  it('организационная сессия мультироли: can(see_commission) = false (даже с partnerRole=admin в клеймах)', () => {
    expect(can(orgContext, 'see_commission')).toBe(false);
  });

  it('партнёрская сессия не получает staff-capability: комиссия партнёра идёт партнёрским контуром, не can()', () => {
    // can() — гейт МЕНЕДЖЕРСКОЙ витрины (getManagerFinanceOverview); партнёру
    // она недоступна в принципе — его комиссия отдаётся через /api/partner/finance.
    expect(can(partnerContext, 'see_commission')).toBe(false);
  });

  it('рядовой менеджер без профиля комиссию не видит, руководитель — видит (legacy-правило)', () => {
    expect(can(managerSession(), 'see_commission')).toBe(false);
    expect(can(managerSession({ role: 'leader' }), 'see_commission')).toBe(true);
  });

  it('профиль доступа — default-deny: без флага комиссии не видит даже руководитель, с флагом — видит и рядовой', () => {
    expect(
      can(managerSession({ role: 'leader', accessProfile: profile([]) }), 'see_commission')
    ).toBe(false);
    expect(
      can(managerSession({ accessProfile: profile(['see_commission']) }), 'see_commission')
    ).toBe(true);
  });
});
