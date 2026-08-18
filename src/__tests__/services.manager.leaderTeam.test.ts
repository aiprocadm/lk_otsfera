/**
 * Unit-тесты сервисов руководителя по команде
 * (src/lib/services/manager/leaderTeam.ts): C8-граница компании при назначении
 * и снятии менеджера, best-effort письмо-приглашение. Валидация формы и
 * revalidatePath — в server-actions.manager.team.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const {
  organizationFindUnique,
  organizationManagerFindUnique,
  createAndAssignManager,
  deactivateAssignment,
  sendManagerInviteEmail,
} = vi.hoisted(() => ({
  organizationFindUnique: vi.fn(),
  organizationManagerFindUnique: vi.fn(),
  createAndAssignManager: vi.fn(),
  deactivateAssignment: vi.fn(),
  sendManagerInviteEmail: vi.fn(),
}));

vi.mock('@/lib/email/send', () => ({ sendManagerInviteEmail }));
vi.mock('@/lib/logging', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    organization: { findUnique: organizationFindUnique },
    organizationManager: { findUnique: organizationManagerFindUnique },
  },
}));
vi.mock('@/lib/services/manager/invite', () => ({
  createAndAssignManager,
  deactivateAssignment,
}));

import { prisma } from '@/lib/db/prisma';
import {
  assignManagerAsLeader,
  deactivateAssignmentAsLeader,
} from '@/lib/services/manager/leaderTeam';

const LEADER_CO_A: SessionPayload = {
  sub: 'leader-1',
  role: 'leader',
  companyId: 'co-A',
  managedOrgIds: ['org-1'],
};

const EXISTING = { mode: 'existing' as const, organizationId: 'org-1', email: 'new@t.local' };

beforeEach(() => {
  vi.clearAllMocks();
});

// ── assignManagerAsLeader ───────────────────────────────────────────────────

describe('assignManagerAsLeader — company boundary (MOST IMPORTANT)', () => {
  it('returns forbidden_org when target org is in a different company', async () => {
    // org belongs to co-B, leader belongs to co-A → cross-company → forbidden
    organizationFindUnique.mockResolvedValue({ companyId: 'co-B' });

    const res = await assignManagerAsLeader(prisma, LEADER_CO_A, {
      ...EXISTING,
      organizationId: 'org-cross',
    });

    expect(res).toEqual({ ok: false, error: 'forbidden_org' });
    expect(createAndAssignManager).not.toHaveBeenCalled();
  });

  it('returns forbidden_org when leader has no companyId', async () => {
    const res = await assignManagerAsLeader(prisma, { ...LEADER_CO_A, companyId: null }, EXISTING);

    expect(res).toEqual({ ok: false, error: 'forbidden_org' });
    expect(organizationFindUnique).not.toHaveBeenCalled();
    expect(createAndAssignManager).not.toHaveBeenCalled();
  });

  it('returns forbidden_org when org does not exist (null → mismatch)', async () => {
    organizationFindUnique.mockResolvedValue(null);

    const res = await assignManagerAsLeader(prisma, LEADER_CO_A, {
      ...EXISTING,
      organizationId: 'org-ghost',
    });

    expect(res).toEqual({ ok: false, error: 'forbidden_org' });
    expect(createAndAssignManager).not.toHaveBeenCalled();
  });
});

describe('assignManagerAsLeader — happy path (same company)', () => {
  it('calls createAndAssignManager with the leader as actor', async () => {
    organizationFindUnique.mockResolvedValue({ companyId: 'co-A' });
    createAndAssignManager.mockResolvedValue({
      ok: true,
      user: { id: 'u-10', email: 'new@t.local' },
      inviteUrl: 'https://app/reset?token=abc',
      alreadyHasPassword: false,
      reactivated: false,
    });

    const res = await assignManagerAsLeader(prisma, LEADER_CO_A, EXISTING);

    expect(res).toEqual({ ok: true, inviteUrl: 'https://app/reset?token=abc', reactivated: false });
    expect(createAndAssignManager).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ organizationId: 'org-1', email: 'new@t.local' }),
      'leader-1'
    );
  });

  it('шлёт письмо-приглашение при inviteUrl (имя организации из prisma)', async () => {
    organizationFindUnique
      .mockResolvedValueOnce({ companyId: 'co-A' }) // company-boundary check
      .mockResolvedValueOnce({ name: 'ООО Ромашка' }); // org name for the email
    createAndAssignManager.mockResolvedValue({
      ok: true,
      user: { id: 'u-10', email: 'new@t.local' },
      inviteUrl: 'https://app/reset?token=abc',
      alreadyHasPassword: false,
      reactivated: false,
    });
    sendManagerInviteEmail.mockResolvedValue({ status: 'sent', id: 'em-1' });

    const res = await assignManagerAsLeader(prisma, { ...LEADER_CO_A, name: 'Лидер' }, EXISTING);

    expect(res).toEqual({ ok: true, inviteUrl: 'https://app/reset?token=abc', reactivated: false });
    expect(sendManagerInviteEmail).toHaveBeenCalledWith({
      to: 'new@t.local',
      organizationName: 'ООО Ромашка',
      inviteUrl: 'https://app/reset?token=abc',
      invitedByName: 'Лидер',
    });
  });

  it('НЕ шлёт письмо, когда inviteUrl === null (пароль уже установлен)', async () => {
    organizationFindUnique.mockResolvedValue({ companyId: 'co-A' });
    createAndAssignManager.mockResolvedValue({
      ok: true,
      user: { id: 'u-11', email: 'old@t.local' },
      inviteUrl: null,
      alreadyHasPassword: true,
      reactivated: false,
    });

    const res = await assignManagerAsLeader(prisma, LEADER_CO_A, {
      ...EXISTING,
      email: 'old@t.local',
    });

    expect(res).toEqual({ ok: true, inviteUrl: null, reactivated: false });
    expect(sendManagerInviteEmail).not.toHaveBeenCalled();
  });

  it('сбой sendManagerInviteEmail best-effort: результат всё равно ok', async () => {
    organizationFindUnique.mockResolvedValue({ companyId: 'co-A' });
    createAndAssignManager.mockResolvedValue({
      ok: true,
      user: { id: 'u-12', email: 'fail@t.local' },
      inviteUrl: 'https://app/reset?token=fail',
      alreadyHasPassword: false,
      reactivated: false,
    });
    sendManagerInviteEmail.mockRejectedValue(new Error('SMTP down'));

    const res = await assignManagerAsLeader(prisma, LEADER_CO_A, {
      ...EXISTING,
      email: 'fail@t.local',
    });

    expect(res).toEqual({
      ok: true,
      inviteUrl: 'https://app/reset?token=fail',
      reactivated: false,
    });
  });

  it('фолбэк «организация», когда org-запись не нашлась при отправке письма', async () => {
    organizationFindUnique.mockResolvedValueOnce({ companyId: 'co-A' }).mockResolvedValueOnce(null);
    createAndAssignManager.mockResolvedValue({
      ok: true,
      user: { id: 'u-13', email: 'ghost@t.local' },
      inviteUrl: 'https://app/reset?token=g',
      alreadyHasPassword: false,
      reactivated: false,
    });
    sendManagerInviteEmail.mockResolvedValue({ status: 'sent', id: null });

    await assignManagerAsLeader(prisma, LEADER_CO_A, { ...EXISTING, email: 'ghost@t.local' });

    expect(sendManagerInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ organizationName: 'организация', invitedByName: undefined })
    );
  });

  it('maps already_assigned Result to {ok:false, error:"already_assigned"}', async () => {
    organizationFindUnique.mockResolvedValue({ companyId: 'co-A' });
    createAndAssignManager.mockResolvedValue({ ok: false, error: 'already_assigned' });

    const res = await assignManagerAsLeader(prisma, LEADER_CO_A, {
      ...EXISTING,
      email: 'dup@t.local',
    });

    expect(res).toEqual({ ok: false, error: 'already_assigned' });
  });

  it('re-throws non-domain errors', async () => {
    organizationFindUnique.mockResolvedValue({ companyId: 'co-A' });
    createAndAssignManager.mockRejectedValue(new Error('DB down'));

    await expect(assignManagerAsLeader(prisma, LEADER_CO_A, EXISTING)).rejects.toThrow('DB down');
  });

  it('режим new пробрасывается в сервис как есть (имя нового пользователя)', async () => {
    organizationFindUnique.mockResolvedValue({ companyId: 'co-A' });
    createAndAssignManager.mockResolvedValue({
      ok: true,
      user: { id: 'u-14', email: 'fresh@t.local' },
      inviteUrl: null,
      alreadyHasPassword: false,
      reactivated: true,
    });

    const res = await assignManagerAsLeader(prisma, LEADER_CO_A, {
      mode: 'new',
      organizationId: 'org-1',
      email: 'fresh@t.local',
      name: 'Новый',
    });

    expect(res).toEqual({ ok: true, inviteUrl: null, reactivated: true });
    expect(createAndAssignManager).toHaveBeenCalledWith(
      prisma,
      { mode: 'new', organizationId: 'org-1', email: 'fresh@t.local', name: 'Новый' },
      'leader-1'
    );
  });
});

// ── deactivateAssignmentAsLeader ────────────────────────────────────────────

describe('deactivateAssignmentAsLeader — company boundary (MOST IMPORTANT)', () => {
  it('returns forbidden_org when assignment org is in a different company', async () => {
    // assignment found but its org → co-B, leader is co-A
    organizationManagerFindUnique.mockResolvedValue({ organizationId: 'org-cross' });
    organizationFindUnique.mockResolvedValue({ companyId: 'co-B' });

    const res = await deactivateAssignmentAsLeader(prisma, LEADER_CO_A, {
      assignmentId: 'asgn-99',
    });

    expect(res).toEqual({ ok: false, error: 'forbidden_org' });
    expect(deactivateAssignment).not.toHaveBeenCalled();
  });

  it('returns forbidden_org when leader has no companyId', async () => {
    organizationManagerFindUnique.mockResolvedValue({ organizationId: 'org-1' });
    organizationFindUnique.mockResolvedValue({ companyId: 'co-A' });

    const res = await deactivateAssignmentAsLeader(
      prisma,
      { ...LEADER_CO_A, companyId: null },
      { assignmentId: 'asgn-10' }
    );

    expect(res).toEqual({ ok: false, error: 'forbidden_org' });
    expect(deactivateAssignment).not.toHaveBeenCalled();
  });

  it('returns not_found when assignment row does not exist', async () => {
    organizationManagerFindUnique.mockResolvedValue(null);

    const res = await deactivateAssignmentAsLeader(prisma, LEADER_CO_A, { assignmentId: 'ghost' });

    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(deactivateAssignment).not.toHaveBeenCalled();
  });
});

describe('deactivateAssignmentAsLeader — happy path (same company)', () => {
  it('calls deactivateAssignment when org is in the same company', async () => {
    organizationManagerFindUnique.mockResolvedValue({ organizationId: 'org-1' });
    organizationFindUnique.mockResolvedValue({ companyId: 'co-A' });
    deactivateAssignment.mockResolvedValue({ ok: true, organizationId: 'org-1' });

    const res = await deactivateAssignmentAsLeader(prisma, LEADER_CO_A, { assignmentId: 'asgn-1' });

    expect(res).toEqual({ ok: true });
    expect(deactivateAssignment).toHaveBeenCalledWith(prisma, 'asgn-1', 'leader-1');
  });

  it('returns not_found when deactivateAssignment returns ok:false', async () => {
    organizationManagerFindUnique.mockResolvedValue({ organizationId: 'org-1' });
    organizationFindUnique.mockResolvedValue({ companyId: 'co-A' });
    deactivateAssignment.mockResolvedValue({ ok: false, reason: 'not_found' });

    const res = await deactivateAssignmentAsLeader(prisma, LEADER_CO_A, { assignmentId: 'gone' });

    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});
