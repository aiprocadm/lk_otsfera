/**
 * Тонкий адаптер команды руководителя: разбор FormData (zod → `validation`),
 * гард роли, прокидка Result и revalidatePath. C8-граница компании, письмо и
 * взаимодействие с invite-сервисом — в services.manager.leaderTeam.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireManagerLeader,
  revalidatePath,
  assignManagerAsLeader,
  deactivateAssignmentAsLeader,
  transferOrganizationAsLeader,
} = vi.hoisted(() => ({
  requireManagerLeader: vi.fn(),
  revalidatePath: vi.fn(),
  assignManagerAsLeader: vi.fn(),
  deactivateAssignmentAsLeader: vi.fn(),
  transferOrganizationAsLeader: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/manager/leaderTeam', () => ({
  assignManagerAsLeader,
  deactivateAssignmentAsLeader,
  transferOrganizationAsLeader,
}));

import { prisma } from '@/lib/db/prisma';
import {
  leaderAssignManagerAction,
  leaderDeactivateAssignmentAction,
  leaderTransferOrganizationAction,
} from '@/server-actions/manager/team';

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  return f;
}

const LEADER_SESSION_CO_A = {
  sub: 'leader-1',
  role: 'leader' as const,
  companyId: 'co-A',
  managedOrgIds: ['org-1'],
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
    expect(assignManagerAsLeader).not.toHaveBeenCalled();
  });

  it('returns validation on bad email', async () => {
    const res = await leaderAssignManagerAction(
      fd({ mode: 'existing', organizationId: 'org-1', email: 'not-an-email' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(assignManagerAsLeader).not.toHaveBeenCalled();
  });
});

describe('leaderAssignManagerAction — delegation', () => {
  it('передаёт разобранную форму в сервис и ревалидирует список команды', async () => {
    assignManagerAsLeader.mockResolvedValue({
      ok: true,
      inviteUrl: 'https://app/reset?token=abc',
      reactivated: false,
    });

    const res = await leaderAssignManagerAction(
      fd({ mode: 'existing', organizationId: 'org-1', email: 'new@t.local' })
    );

    expect(res).toEqual({ ok: true, inviteUrl: 'https://app/reset?token=abc', reactivated: false });
    expect(assignManagerAsLeader).toHaveBeenCalledWith(prisma, LEADER_SESSION_CO_A, {
      mode: 'existing',
      organizationId: 'org-1',
      email: 'new@t.local',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/leader/team');
  });

  it('режим new с именем: ключ name присутствует только когда он задан', async () => {
    assignManagerAsLeader.mockResolvedValue({ ok: true, inviteUrl: null, reactivated: false });

    await leaderAssignManagerAction(
      fd({ mode: 'new', organizationId: 'org-1', email: 'a@t.local', name: 'Пётр' })
    );
    expect(assignManagerAsLeader).toHaveBeenLastCalledWith(prisma, LEADER_SESSION_CO_A, {
      mode: 'new',
      organizationId: 'org-1',
      email: 'a@t.local',
      name: 'Пётр',
    });

    await leaderAssignManagerAction(
      fd({ mode: 'new', organizationId: 'org-1', email: 'b@t.local' })
    );
    expect(assignManagerAsLeader).toHaveBeenLastCalledWith(prisma, LEADER_SESSION_CO_A, {
      mode: 'new',
      organizationId: 'org-1',
      email: 'b@t.local',
    });
  });

  it('коды отказа сервиса прокидываются без ревалидации', async () => {
    for (const error of ['forbidden_org', 'already_assigned', 'company_mismatch']) {
      assignManagerAsLeader.mockResolvedValue({ ok: false, error });
      const res = await leaderAssignManagerAction(
        fd({ mode: 'existing', organizationId: 'org-1', email: 'mgr@t.local' })
      );
      expect(res).toEqual({ ok: false, error });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('re-throws non-domain errors', async () => {
    assignManagerAsLeader.mockRejectedValue(new Error('DB down'));

    await expect(
      leaderAssignManagerAction(
        fd({ mode: 'existing', organizationId: 'org-1', email: 'mgr@t.local' })
      )
    ).rejects.toThrow('DB down');
  });
});

// ── leaderDeactivateAssignmentAction ────────────────────────────────────────

describe('leaderDeactivateAssignmentAction', () => {
  it('returns validation when assignmentId missing', async () => {
    const res = await leaderDeactivateAssignmentAction(fd({}));
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(deactivateAssignmentAsLeader).not.toHaveBeenCalled();
  });

  it('делегирует в сервис и ревалидирует список команды', async () => {
    deactivateAssignmentAsLeader.mockResolvedValue({ ok: true });

    const res = await leaderDeactivateAssignmentAction(fd({ assignmentId: 'asgn-1' }));

    expect(res).toEqual({ ok: true });
    expect(deactivateAssignmentAsLeader).toHaveBeenCalledWith(prisma, LEADER_SESSION_CO_A, {
      assignmentId: 'asgn-1',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/leader/team');
  });

  it('коды отказа сервиса прокидываются без ревалидации', async () => {
    for (const error of ['forbidden_org', 'not_found']) {
      deactivateAssignmentAsLeader.mockResolvedValue({ ok: false, error });
      const res = await leaderDeactivateAssignmentAction(fd({ assignmentId: 'x' }));
      expect(res).toEqual({ ok: false, error });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('leaderTransferOrganizationAction (`У-346`)', () => {
  it('без любого из трёх полей — validation, сервис не зовётся', async () => {
    const res = await leaderTransferOrganizationAction(
      fd({ organizationId: 'o1', fromUserId: 'm1' })
    );
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(transferOrganizationAsLeader).not.toHaveBeenCalled();
  });

  it('делегирует в сервис с сессией и ревалидирует «Команду»', async () => {
    requireManagerLeader.mockResolvedValue(LEADER_SESSION_CO_A);
    transferOrganizationAsLeader.mockResolvedValue({ ok: true, ordersMoved: 3 });
    const res = await leaderTransferOrganizationAction(
      fd({ organizationId: 'o1', fromUserId: 'm1', toUserId: 'm2' })
    );
    expect(res).toEqual({ ok: true, ordersMoved: 3 });
    expect(transferOrganizationAsLeader).toHaveBeenCalledWith(prisma, LEADER_SESSION_CO_A, {
      organizationId: 'o1',
      fromUserId: 'm1',
      toUserId: 'm2',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/leader/team');
  });

  it('отказ сервиса прокидывается без ревалидации', async () => {
    requireManagerLeader.mockResolvedValue(LEADER_SESSION_CO_A);
    transferOrganizationAsLeader.mockResolvedValue({ ok: false, error: 'forbidden_org' });
    const res = await leaderTransferOrganizationAction(
      fd({ organizationId: 'o1', fromUserId: 'm1', toUserId: 'm2' })
    );
    expect(res).toEqual({ ok: false, error: 'forbidden_org' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
