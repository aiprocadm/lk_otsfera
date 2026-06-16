import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireManagerLeader,
  revalidatePath,
  organizationFindUnique,
  organizationManagerFindUnique,
  createAndAssignManager,
  deactivateAssignment
} = vi.hoisted(() => ({
  requireManagerLeader: vi.fn(),
  revalidatePath: vi.fn(),
  organizationFindUnique: vi.fn(),
  organizationManagerFindUnique: vi.fn(),
  createAndAssignManager: vi.fn(),
  deactivateAssignment: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    organization: { findUnique: organizationFindUnique },
    organizationManager: { findUnique: organizationManagerFindUnique }
  }
}));
vi.mock('@/lib/services/manager/invite', () => ({
  createAndAssignManager,
  deactivateAssignment,
  ManagerInviteError: class ManagerInviteError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
}));

import {
  leaderAssignManagerAction,
  leaderDeactivateAssignmentAction
} from '@/server-actions/manager/team';

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  return f;
}

const LEADER_SESSION_CO_A = {
  sub: 'leader-1',
  role: 'manager' as const,
  managerRole: 'leader' as const,
  companyId: 'co-A',
  managedOrgIds: ['org-1']
};

beforeEach(() => {
  vi.clearAllMocks();
  requireManagerLeader.mockResolvedValue(LEADER_SESSION_CO_A);
  revalidatePath.mockReturnValue(undefined);
});

// ── leaderAssignManagerAction ──────────────────────────────────────────────

describe('leaderAssignManagerAction — validation', () => {
  it('returns validation on missing fields', async () => {
    const res = await leaderAssignManagerAction(fd({}));
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(createAndAssignManager).not.toHaveBeenCalled();
  });

  it('returns validation on bad email', async () => {
    const res = await leaderAssignManagerAction(
      fd({ mode: 'existing', organizationId: 'org-1', email: 'not-an-email' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
  });
});

describe('leaderAssignManagerAction — company boundary (MOST IMPORTANT)', () => {
  it('returns forbidden_org when target org is in a different company', async () => {
    // org belongs to co-B, leader belongs to co-A → cross-company → forbidden
    organizationFindUnique.mockResolvedValue({ companyId: 'co-B' });

    const res = await leaderAssignManagerAction(
      fd({ mode: 'existing', organizationId: 'org-cross', email: 'mgr@t.local' })
    );

    expect(res).toEqual({ ok: false, error: 'forbidden_org' });
    expect(createAndAssignManager).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns forbidden_org when leader has no companyId', async () => {
    requireManagerLeader.mockResolvedValue({ ...LEADER_SESSION_CO_A, companyId: undefined });

    const res = await leaderAssignManagerAction(
      fd({ mode: 'existing', organizationId: 'org-1', email: 'mgr@t.local' })
    );

    expect(res).toEqual({ ok: false, error: 'forbidden_org' });
    expect(createAndAssignManager).not.toHaveBeenCalled();
  });

  it('returns forbidden_org when org does not exist (null → mismatch)', async () => {
    organizationFindUnique.mockResolvedValue(null);

    const res = await leaderAssignManagerAction(
      fd({ mode: 'existing', organizationId: 'org-ghost', email: 'mgr@t.local' })
    );

    expect(res).toEqual({ ok: false, error: 'forbidden_org' });
    expect(createAndAssignManager).not.toHaveBeenCalled();
  });
});

describe('leaderAssignManagerAction — happy path (same company)', () => {
  it('calls createAndAssignManager and revalidates when org is in the same company', async () => {
    organizationFindUnique.mockResolvedValue({ companyId: 'co-A' });
    createAndAssignManager.mockResolvedValue({
      user: { id: 'u-10', email: 'new@t.local' },
      inviteUrl: 'https://app/reset?token=abc',
      alreadyHasPassword: false,
      reactivated: false
    });

    const res = await leaderAssignManagerAction(
      fd({ mode: 'existing', organizationId: 'org-1', email: 'new@t.local' })
    );

    expect(res).toEqual({ ok: true, inviteUrl: 'https://app/reset?token=abc', reactivated: false });
    expect(createAndAssignManager).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-1', email: 'new@t.local' }),
      'leader-1'
    );
    expect(revalidatePath).toHaveBeenCalledWith('/manager/team');
  });

  it('maps ManagerInviteError(already_assigned) to {ok:false, error:"already_assigned"}', async () => {
    const { ManagerInviteError } = await import('@/lib/services/manager/invite');
    organizationFindUnique.mockResolvedValue({ companyId: 'co-A' });
    createAndAssignManager.mockRejectedValue(new ManagerInviteError('already_assigned'));

    const res = await leaderAssignManagerAction(
      fd({ mode: 'existing', organizationId: 'org-1', email: 'dup@t.local' })
    );

    expect(res).toEqual({ ok: false, error: 'already_assigned' });
  });

  it('re-throws non-domain errors', async () => {
    organizationFindUnique.mockResolvedValue({ companyId: 'co-A' });
    createAndAssignManager.mockRejectedValue(new Error('DB down'));

    await expect(
      leaderAssignManagerAction(
        fd({ mode: 'existing', organizationId: 'org-1', email: 'mgr@t.local' })
      )
    ).rejects.toThrow('DB down');
  });
});

// ── leaderDeactivateAssignmentAction ────────────────────────────────────────

describe('leaderDeactivateAssignmentAction — validation', () => {
  it('returns validation when assignmentId missing', async () => {
    const res = await leaderDeactivateAssignmentAction(fd({}));
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(deactivateAssignment).not.toHaveBeenCalled();
  });
});

describe('leaderDeactivateAssignmentAction — company boundary (MOST IMPORTANT)', () => {
  it('returns forbidden_org when assignment org is in a different company', async () => {
    // assignment found but its org → co-B, leader is co-A
    organizationManagerFindUnique.mockResolvedValue({ organizationId: 'org-cross' });
    organizationFindUnique.mockResolvedValue({ companyId: 'co-B' });

    const res = await leaderDeactivateAssignmentAction(fd({ assignmentId: 'asgn-99' }));

    expect(res).toEqual({ ok: false, error: 'forbidden_org' });
    expect(deactivateAssignment).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns forbidden_org when leader has no companyId', async () => {
    requireManagerLeader.mockResolvedValue({ ...LEADER_SESSION_CO_A, companyId: undefined });
    organizationManagerFindUnique.mockResolvedValue({ organizationId: 'org-1' });
    organizationFindUnique.mockResolvedValue({ companyId: 'co-A' });

    const res = await leaderDeactivateAssignmentAction(fd({ assignmentId: 'asgn-10' }));

    expect(res).toEqual({ ok: false, error: 'forbidden_org' });
    expect(deactivateAssignment).not.toHaveBeenCalled();
  });

  it('returns not_found when assignment row does not exist', async () => {
    organizationManagerFindUnique.mockResolvedValue(null);

    const res = await leaderDeactivateAssignmentAction(fd({ assignmentId: 'ghost' }));

    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(deactivateAssignment).not.toHaveBeenCalled();
  });
});

describe('leaderDeactivateAssignmentAction — happy path (same company)', () => {
  it('calls deactivateAssignment and revalidates when org is in the same company', async () => {
    organizationManagerFindUnique.mockResolvedValue({ organizationId: 'org-1' });
    organizationFindUnique.mockResolvedValue({ companyId: 'co-A' });
    deactivateAssignment.mockResolvedValue({ ok: true, organizationId: 'org-1' });

    const res = await leaderDeactivateAssignmentAction(fd({ assignmentId: 'asgn-1' }));

    expect(res).toEqual({ ok: true });
    expect(deactivateAssignment).toHaveBeenCalledWith(expect.anything(), 'asgn-1', 'leader-1');
    expect(revalidatePath).toHaveBeenCalledWith('/manager/team');
  });

  it('returns not_found when deactivateAssignment returns ok:false', async () => {
    organizationManagerFindUnique.mockResolvedValue({ organizationId: 'org-1' });
    organizationFindUnique.mockResolvedValue({ companyId: 'co-A' });
    deactivateAssignment.mockResolvedValue({ ok: false, reason: 'not_found' });

    const res = await leaderDeactivateAssignmentAction(fd({ assignmentId: 'gone' }));

    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
