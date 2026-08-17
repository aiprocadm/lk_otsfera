import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, redirect, notFound, orderFindUnique, commentCount, companyFindUnique } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    redirect: vi.fn(),
    notFound: vi.fn(),
    orderFindUnique: vi.fn(),
    commentCount: vi.fn(),
    companyFindUnique: vi.fn(),
  }));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('next/navigation', () => ({ redirect, notFound }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    order: { findUnique: orderFindUnique },
    comment: { count: commentCount },
    company: { findUnique: companyFindUnique },
  },
}));

import {
  requireManager,
  requireManagerForOrg,
  requireManagerForOrder,
  requireManagerLeader,
} from '@/lib/auth/requireRole';
import type { SessionPayload } from '@/lib/auth/jwt';

const MANAGER_WITH_SCOPE: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-A', 'org-B'],
};

const MANAGER_EMPTY_SCOPE: SessionPayload = {
  sub: 'mgr-2',
  role: 'manager',
  managedOrgIds: [],
};

const MANAGER_NO_MANAGED_ORG_IDS_FIELD: SessionPayload = {
  // No managedOrgIds field at all → loader did not run, treat as unauthenticated.
  sub: 'mgr-3',
  role: 'manager',
};

const PARTNER_SESSION: SessionPayload = {
  sub: 'u-partner',
  role: 'partner',
  partnerRole: 'admin',
};

describe('requireManager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    redirect.mockImplementation((to: string) => {
      throw new Error(`NEXT_REDIRECT:${to}`);
    });
    notFound.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
  });

  it('returns session for manager with non-empty managedOrgIds', async () => {
    getSession.mockResolvedValue(MANAGER_WITH_SCOPE);
    const result = await requireManager();
    expect(result).toEqual(MANAGER_WITH_SCOPE);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('returns session for manager with empty managedOrgIds (empty scope OK)', async () => {
    getSession.mockResolvedValue(MANAGER_EMPTY_SCOPE);
    const result = await requireManager();
    expect(result).toEqual(MANAGER_EMPTY_SCOPE);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects to /login when session is null (unauthenticated)', async () => {
    getSession.mockResolvedValue(null);
    await expect(requireManager()).rejects.toThrow('NEXT_REDIRECT:/login');
  });

  it('redirects to /login when role=manager but managedOrgIds is undefined (loader did not run)', async () => {
    getSession.mockResolvedValue(MANAGER_NO_MANAGED_ORG_IDS_FIELD);
    await expect(requireManager()).rejects.toThrow('NEXT_REDIRECT:/login');
  });

  it('redirects to /forbidden when role !== manager', async () => {
    getSession.mockResolvedValue(PARTNER_SESSION);
    await expect(requireManager()).rejects.toThrow('NEXT_REDIRECT:/forbidden');
  });

  // ТЗ 2026-08-17 (PR-1): кабинет менеджера открыт top-level роли leader
  // («играющий тренер», Р-Л-3) — как раньше старой паре manager+managerRole.
  it('returns session for top-level leader role (Р-Л-3)', async () => {
    const leader: SessionPayload = {
      sub: 'ldr-1',
      role: 'leader',
      managedOrgIds: [],
    } as SessionPayload;
    getSession.mockResolvedValue(leader);
    const result = await requireManager();
    expect(result).toEqual(leader);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('requireManagerLeader — обе модели руководителя (ТЗ 2026-08-17)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    redirect.mockImplementation((to: string) => {
      throw new Error(`NEXT_REDIRECT:${to}`);
    });
  });

  it('пускает старую пару manager + managerRole=leader', async () => {
    getSession.mockResolvedValue({
      sub: 'ldr-old',
      role: 'manager',
      managerRole: 'leader',
      managedOrgIds: [],
    } as SessionPayload);
    const result = await requireManagerLeader();
    expect(result.sub).toBe('ldr-old');
  });

  it('пускает новую top-level роль leader', async () => {
    getSession.mockResolvedValue({
      sub: 'ldr-new',
      role: 'leader',
      managedOrgIds: [],
    } as SessionPayload);
    const result = await requireManagerLeader();
    expect(result.sub).toBe('ldr-new');
  });

  it('рядового менеджера по-прежнему бьёт /forbidden', async () => {
    getSession.mockResolvedValue(MANAGER_WITH_SCOPE);
    await expect(requireManagerLeader()).rejects.toThrow('NEXT_REDIRECT:/forbidden');
  });
});

describe('requireManagerForOrg', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    redirect.mockImplementation((to: string) => {
      throw new Error(`NEXT_REDIRECT:${to}`);
    });
  });

  it('returns session when orgId is in scope', async () => {
    getSession.mockResolvedValue(MANAGER_WITH_SCOPE);
    const result = await requireManagerForOrg('org-A');
    expect(result).toEqual(MANAGER_WITH_SCOPE);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects to /manager/dashboard when orgId is not in scope', async () => {
    getSession.mockResolvedValue(MANAGER_WITH_SCOPE);
    await expect(requireManagerForOrg('org-X')).rejects.toThrow('NEXT_REDIRECT:/manager/dashboard');
  });

  it('redirects to /manager/dashboard when scope is empty', async () => {
    getSession.mockResolvedValue(MANAGER_EMPTY_SCOPE);
    await expect(requireManagerForOrg('org-A')).rejects.toThrow('NEXT_REDIRECT:/manager/dashboard');
  });

  it('redirects to /forbidden when caller is not a manager (delegates to requireManager)', async () => {
    getSession.mockResolvedValue(PARTNER_SESSION);
    await expect(requireManagerForOrg('org-A')).rejects.toThrow('NEXT_REDIRECT:/forbidden');
  });
});

describe('requireManagerForOrder', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    redirect.mockImplementation((to: string) => {
      throw new Error(`NEXT_REDIRECT:${to}`);
    });
    notFound.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
  });

  it('returns {session, order} when manager owns the order via managerId', async () => {
    getSession.mockResolvedValue(MANAGER_WITH_SCOPE);
    orderFindUnique.mockResolvedValue({
      id: 'order-1',
      managerId: 'mgr-1',
      organizationId: 'org-X',
    });
    commentCount.mockResolvedValue(0);

    const result = await requireManagerForOrder('order-1');
    expect(result).toEqual({
      session: MANAGER_WITH_SCOPE,
      order: { id: 'order-1', managerId: 'mgr-1', organizationId: 'org-X' },
    });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('returns {session, order} when order.organizationId is in scope', async () => {
    getSession.mockResolvedValue(MANAGER_WITH_SCOPE);
    orderFindUnique.mockResolvedValue({
      id: 'order-2',
      managerId: 'other-user',
      organizationId: 'org-A',
    });
    commentCount.mockResolvedValue(0);

    const result = await requireManagerForOrder('order-2');
    expect(result.order.id).toBe('order-2');
    expect(notFound).not.toHaveBeenCalled();
  });

  it('returns {session, order} when manager has historical comments on the order', async () => {
    getSession.mockResolvedValue(MANAGER_WITH_SCOPE);
    orderFindUnique.mockResolvedValue({
      id: 'order-3',
      managerId: 'other-user',
      organizationId: 'org-X', // out of scope
    });
    commentCount.mockResolvedValue(2);

    const result = await requireManagerForOrder('order-3');
    expect(result.order.id).toBe('order-3');
    expect(notFound).not.toHaveBeenCalled();
    expect(commentCount).toHaveBeenCalledWith({
      where: { orderId: 'order-3', authorId: 'mgr-1' },
    });
  });

  it('calls notFound() when the order does not exist', async () => {
    getSession.mockResolvedValue(MANAGER_WITH_SCOPE);
    orderFindUnique.mockResolvedValue(null);

    await expect(requireManagerForOrder('order-missing')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('calls notFound() when canSeeOrder returns false (no scope, no ownership, no history)', async () => {
    getSession.mockResolvedValue(MANAGER_WITH_SCOPE);
    orderFindUnique.mockResolvedValue({
      id: 'order-foreign',
      managerId: 'other-user',
      organizationId: 'org-X', // not in MANAGER_WITH_SCOPE.managedOrgIds
    });
    commentCount.mockResolvedValue(0);

    await expect(requireManagerForOrder('order-foreign')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('redirects to /forbidden when caller is not a manager', async () => {
    getSession.mockResolvedValue(PARTNER_SESSION);
    await expect(requireManagerForOrder('order-1')).rejects.toThrow('NEXT_REDIRECT:/forbidden');
    expect(orderFindUnique).not.toHaveBeenCalled();
  });

  // ----- Leader rule (Task 5): руководитель открывает любой заказ своей компании -----

  const LEADER_C1: SessionPayload = {
    sub: 'mgr-leader',
    role: 'manager',
    managedOrgIds: [],
    managerRole: 'leader',
    companyId: 'c1',
  };

  it('leader открывает заказ своей компании даже при toggle OFF (нет ни managerId, ни org-scope, ни истории)', async () => {
    getSession.mockResolvedValue(LEADER_C1);
    companyFindUnique.mockResolvedValue({ managerTeamVisibility: false }); // toggle OFF
    orderFindUnique.mockResolvedValue({
      id: 'order-own',
      managerId: 'someone-else',
      organizationId: 'org-X', // out of leader's empty scope
      companyId: 'c1',
    });
    commentCount.mockResolvedValue(0);

    const result = await requireManagerForOrder('order-own');
    expect(result.order.id).toBe('order-own');
    expect(notFound).not.toHaveBeenCalled();
    // leader rule fires before the three-way check → no comment lookup needed
    expect(commentCount).not.toHaveBeenCalled();
  });

  it('leader НЕ открывает заказ ДРУГОЙ компании (cross-company инвариант)', async () => {
    getSession.mockResolvedValue(LEADER_C1);
    companyFindUnique.mockResolvedValue({ managerTeamVisibility: false });
    orderFindUnique.mockResolvedValue({
      id: 'order-foreign-company',
      managerId: 'someone-else',
      organizationId: 'org-X',
      companyId: 'c2', // другая компания
    });
    commentCount.mockResolvedValue(0);

    await expect(requireManagerForOrder('order-foreign-company')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('leader с companyId=null → правило не срабатывает, нормальный three-way (deny)', async () => {
    getSession.mockResolvedValue({
      sub: 'mgr-leader-nocompany',
      role: 'manager',
      managedOrgIds: [],
      managerRole: 'leader',
      // companyId отсутствует
    } as SessionPayload);
    orderFindUnique.mockResolvedValue({
      id: 'order-no-company-leader',
      managerId: 'someone-else',
      organizationId: 'org-X',
      companyId: 'c1',
    });
    commentCount.mockResolvedValue(0);

    await expect(requireManagerForOrder('order-no-company-leader')).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
    expect(notFound).toHaveBeenCalled();
    // getCompanyTeamVisibility short-circuits on missing companyId — no company read
    expect(companyFindUnique).not.toHaveBeenCalled();
  });
});

describe('requireManagerLeader', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    redirect.mockImplementation((to: string) => {
      throw new Error(`NEXT_REDIRECT:${to}`);
    });
  });

  const MANAGER_LEADER: SessionPayload = {
    sub: 'mgr-leader',
    role: 'manager',
    managedOrgIds: [],
    managerRole: 'leader',
  };

  it('возвращает сессию для manager-leader', async () => {
    getSession.mockResolvedValue(MANAGER_LEADER);
    const result = await requireManagerLeader();
    expect(result).toEqual(MANAGER_LEADER);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('редиректит manager-не-leader на /forbidden (единый контракт под-ролей)', async () => {
    getSession.mockResolvedValue(MANAGER_WITH_SCOPE);
    await expect(requireManagerLeader()).rejects.toThrow('NEXT_REDIRECT:/forbidden');
  });

  it('редиректит не-manager на /forbidden (делегирует requireManager)', async () => {
    getSession.mockResolvedValue(PARTNER_SESSION);
    await expect(requireManagerLeader()).rejects.toThrow('NEXT_REDIRECT:/forbidden');
  });
});
