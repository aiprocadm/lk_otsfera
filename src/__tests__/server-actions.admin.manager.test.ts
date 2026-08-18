import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdmin,
  createAndAssignManager,
  deactivateAssignment,
  reactivateAssignment,
  sendManagerInviteEmail,
  revalidatePath,
  getOrganizationName,
  orderFindUnique,
  orderUpdate,
  userFindUnique,
  recordAudit,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAndAssignManager: vi.fn(),
  deactivateAssignment: vi.fn(),
  reactivateAssignment: vi.fn(),
  sendManagerInviteEmail: vi.fn(),
  revalidatePath: vi.fn(),
  getOrganizationName: vi.fn(),
  orderFindUnique: vi.fn(),
  orderUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    order: { findUnique: orderFindUnique, update: orderUpdate },
    user: { findUnique: userFindUnique },
  },
}));
vi.mock('@/lib/services/organization/lookup', () => ({ getOrganizationName }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/email/send', () => ({ sendManagerInviteEmail }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/services/manager/invite', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/manager/invite')>(
    '@/lib/services/manager/invite'
  );
  return {
    ...actual,
    createAndAssignManager,
    deactivateAssignment,
    reactivateAssignment,
  };
});

import {
  assignOrInviteManagerAction,
  deactivateManagerAssignmentAction,
  reactivateManagerAssignmentAction,
  assignOrderManagerAction,
  deactivateManagerAssignmentFormAction,
  reactivateManagerAssignmentFormAction,
} from '@/server-actions/admin/manager';

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ sub: 'admin-1', name: 'Plat Admin' });
});

describe('assignOrInviteManagerAction', () => {
  it('returns validation on missing fields — bare stable code, no zod details (R2)', async () => {
    const res = await assignOrInviteManagerAction(fd({}));
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(createAndAssignManager).not.toHaveBeenCalled();
  });

  it('returns validation on bad email', async () => {
    const res = await assignOrInviteManagerAction(
      fd({ mode: 'existing', organizationId: 'org-1', email: 'not-an-email' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
  });

  it('happy path mode=new — calls service, sends invite email, revalidates', async () => {
    getOrganizationName.mockResolvedValue('ACME');
    createAndAssignManager.mockResolvedValue({
      ok: true,
      user: { id: 'u-2', email: 'new@t.local' },
      inviteUrl: 'https://app/reset-password?token=xyz',
      alreadyHasPassword: false,
      reactivated: false,
    });
    sendManagerInviteEmail.mockResolvedValue({ status: 'sent', id: 'em-1' });

    const res = await assignOrInviteManagerAction(
      fd({
        mode: 'new',
        organizationId: 'org-1',
        email: 'new@t.local',
        name: 'Fresh Mgr',
      })
    );

    expect(res).toEqual({
      ok: true,
      user: { id: 'u-2', email: 'new@t.local' },
      inviteUrl: 'https://app/reset-password?token=xyz',
      alreadyHasPassword: false,
      reactivated: false,
    });
    expect(createAndAssignManager).toHaveBeenCalledWith(
      expect.anything(),
      { mode: 'new', organizationId: 'org-1', email: 'new@t.local', name: 'Fresh Mgr' },
      'admin-1'
    );
    expect(sendManagerInviteEmail).toHaveBeenCalledWith({
      to: 'new@t.local',
      organizationName: 'ACME',
      inviteUrl: 'https://app/reset-password?token=xyz',
      invitedByName: 'Plat Admin',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/organizations/org-1');
  });

  it('happy path mode=existing — when service returns null inviteUrl, no email sent', async () => {
    createAndAssignManager.mockResolvedValue({
      ok: true,
      user: { id: 'u-3', email: 'has@t.local' },
      inviteUrl: null,
      alreadyHasPassword: true,
      reactivated: false,
    });

    const res = await assignOrInviteManagerAction(
      fd({ mode: 'existing', organizationId: 'org-2', email: 'has@t.local' })
    );

    expect(res).toMatchObject({ ok: true, alreadyHasPassword: true });
    expect(sendManagerInviteEmail).not.toHaveBeenCalled();
    expect(getOrganizationName).not.toHaveBeenCalled(); // skipped when no inviteUrl
  });

  it('mode=new без name — ключ name в сервис не передаётся (exactOptionalPropertyTypes)', async () => {
    createAndAssignManager.mockResolvedValue({
      ok: true,
      user: { id: 'u-nn', email: 'noname@t.local' },
      inviteUrl: null,
      alreadyHasPassword: true,
      reactivated: false,
    });

    const res = await assignOrInviteManagerAction(
      fd({ mode: 'new', organizationId: 'org-1', email: 'noname@t.local' })
    );

    expect(res).toMatchObject({ ok: true });
    expect(createAndAssignManager).toHaveBeenCalledWith(
      expect.anything(),
      { mode: 'new', organizationId: 'org-1', email: 'noname@t.local' },
      'admin-1'
    );
  });

  it('maps role_conflict Result to {ok:false, error:"role_conflict"}', async () => {
    createAndAssignManager.mockResolvedValue({ ok: false, error: 'role_conflict' });
    const res = await assignOrInviteManagerAction(
      fd({ mode: 'existing', organizationId: 'org-1', email: 'org@t.local' })
    );
    expect(res).toEqual({ ok: false, error: 'role_conflict' });
  });

  it('maps already_assigned Result', async () => {
    createAndAssignManager.mockResolvedValue({ ok: false, error: 'already_assigned' });
    const res = await assignOrInviteManagerAction(
      fd({ mode: 'existing', organizationId: 'org-1', email: 'has@t.local' })
    );
    expect(res).toEqual({ ok: false, error: 'already_assigned' });
  });

  it('re-throws non-domain errors', async () => {
    createAndAssignManager.mockRejectedValue(new Error('db-down'));
    await expect(
      assignOrInviteManagerAction(
        fd({ mode: 'existing', organizationId: 'org-1', email: 'has@t.local' })
      )
    ).rejects.toThrow(/db-down/);
  });
});

describe('deactivateManagerAssignmentAction / reactivateManagerAssignmentAction', () => {
  it('deactivate happy path', async () => {
    deactivateAssignment.mockResolvedValue({ ok: true, organizationId: 'org-9' });
    const res = await deactivateManagerAssignmentAction(fd({ assignmentId: 'a-1' }));
    expect(res).toEqual({ ok: true });
    expect(deactivateAssignment).toHaveBeenCalledWith(expect.anything(), 'a-1', 'admin-1');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/organizations/org-9');
  });

  it('deactivate not_found maps to {ok:false, error:"not_found"}', async () => {
    deactivateAssignment.mockResolvedValue({ ok: false, reason: 'not_found' });
    const res = await deactivateManagerAssignmentAction(fd({ assignmentId: 'bad' }));
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('deactivate validation when assignmentId missing', async () => {
    const res = await deactivateManagerAssignmentAction(fd({}));
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(deactivateAssignment).not.toHaveBeenCalled();
  });

  it('reactivate happy path', async () => {
    reactivateAssignment.mockResolvedValue({ ok: true, organizationId: 'org-9' });
    const res = await reactivateManagerAssignmentAction(fd({ assignmentId: 'a-2' }));
    expect(res).toEqual({ ok: true });
    expect(reactivateAssignment).toHaveBeenCalledWith(expect.anything(), 'a-2', 'admin-1');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/organizations/org-9');
  });

  it('reactivate not_found', async () => {
    reactivateAssignment.mockResolvedValue({ ok: false, reason: 'not_found' });
    const res = await reactivateManagerAssignmentAction(fd({ assignmentId: 'bad' }));
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('assignOrderManagerAction', () => {
  it('returns validation when orderId missing — bare stable code, no zod details (R2)', async () => {
    const res = await assignOrderManagerAction(fd({ managerUserId: 'm-1' }));
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it('order_not_found when order does not exist', async () => {
    userFindUnique.mockResolvedValue({ role: 'manager', isActive: true });
    orderFindUnique.mockResolvedValue(null);
    const res = await assignOrderManagerAction(fd({ orderId: 'no-order', managerUserId: 'm-1' }));
    expect(res).toEqual({ ok: false, error: 'order_not_found' });
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('invalid_manager when user is not a manager', async () => {
    userFindUnique.mockResolvedValue({ role: 'partner', isActive: true });
    const res = await assignOrderManagerAction(fd({ orderId: 'o-1', managerUserId: 'p-1' }));
    expect(res).toEqual({ ok: false, error: 'invalid_manager' });
    expect(orderFindUnique).not.toHaveBeenCalled();
  });

  it('invalid_manager when manager is inactive', async () => {
    userFindUnique.mockResolvedValue({ role: 'manager', isActive: false });
    const res = await assignOrderManagerAction(fd({ orderId: 'o-1', managerUserId: 'm-x' }));
    expect(res).toEqual({ ok: false, error: 'invalid_manager' });
  });

  it('invalid_manager when user does not exist', async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await assignOrderManagerAction(fd({ orderId: 'o-1', managerUserId: 'missing' }));
    expect(res).toEqual({ ok: false, error: 'invalid_manager' });
  });

  it('happy path — sets managerId, records audit, revalidates', async () => {
    userFindUnique.mockResolvedValue({ role: 'manager', isActive: true });
    orderFindUnique.mockResolvedValue({ managerId: null });

    const res = await assignOrderManagerAction(fd({ orderId: 'o-1', managerUserId: 'm-1' }));
    expect(res).toEqual({ ok: true, changed: true });
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'o-1' },
      data: { managerId: 'm-1' },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'order_manager_changed',
        entity: 'order',
        entityId: 'o-1',
        before: { managerId: null },
        after: { managerId: 'm-1' },
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/admin/orders/o-1');
  });

  it('happy path — clears managerId when managerUserId is empty', async () => {
    orderFindUnique.mockResolvedValue({ managerId: 'm-old' });

    const res = await assignOrderManagerAction(fd({ orderId: 'o-1', managerUserId: '' }));
    expect(res).toEqual({ ok: true, changed: true });
    expect(userFindUnique).not.toHaveBeenCalled(); // no validation needed when clearing
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'o-1' },
      data: { managerId: null },
    });
  });

  it('no-op when managerId already matches target', async () => {
    userFindUnique.mockResolvedValue({ role: 'manager', isActive: true });
    orderFindUnique.mockResolvedValue({ managerId: 'm-1' });

    const res = await assignOrderManagerAction(fd({ orderId: 'o-1', managerUserId: 'm-1' }));
    expect(res).toEqual({ ok: true, changed: false });
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('assignOrInviteManagerAction — email failure (graceful degradation)', () => {
  it('still returns ok:true when sendManagerInviteEmail throws', async () => {
    getOrganizationName.mockResolvedValue('ACME');
    createAndAssignManager.mockResolvedValue({
      ok: true,
      user: { id: 'u-5', email: 'invite@t.local' },
      inviteUrl: 'https://app/reset-password?token=tok',
      alreadyHasPassword: false,
      reactivated: false,
    });
    sendManagerInviteEmail.mockRejectedValue(new Error('SMTP down'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await assignOrInviteManagerAction(
      fd({ mode: 'new', organizationId: 'org-1', email: 'invite@t.local', name: 'New' })
    );
    expect(res).toMatchObject({ ok: true });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('uses fallback "организация" when org lookup returns null during email send', async () => {
    getOrganizationName.mockResolvedValue(null);
    createAndAssignManager.mockResolvedValue({
      ok: true,
      user: { id: 'u-6', email: 'inv2@t.local' },
      inviteUrl: 'https://app/reset-password?token=tok2',
      alreadyHasPassword: false,
      reactivated: false,
    });
    sendManagerInviteEmail.mockResolvedValue({ status: 'sent' });

    const res = await assignOrInviteManagerAction(
      fd({ mode: 'new', organizationId: 'org-missing', email: 'inv2@t.local', name: 'N' })
    );
    expect(res).toMatchObject({ ok: true });
    expect(sendManagerInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ organizationName: 'организация' })
    );
  });

  it('uses undefined invitedByName when session.name is absent', async () => {
    requireAdmin.mockResolvedValue({ sub: 'admin-1', name: null });
    getOrganizationName.mockResolvedValue('ACME');
    createAndAssignManager.mockResolvedValue({
      ok: true,
      user: { id: 'u-7', email: 'inv3@t.local' },
      inviteUrl: 'https://app/reset-password?token=tok3',
      alreadyHasPassword: false,
      reactivated: false,
    });
    sendManagerInviteEmail.mockResolvedValue({ status: 'sent' });

    await assignOrInviteManagerAction(
      fd({ mode: 'new', organizationId: 'org-1', email: 'inv3@t.local', name: 'N' })
    );
    expect(sendManagerInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ invitedByName: undefined })
    );
  });
});

describe('reactivateManagerAssignmentAction — validation', () => {
  it('returns validation when assignmentId is missing', async () => {
    const res = await reactivateManagerAssignmentAction(fd({}));
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(reactivateAssignment).not.toHaveBeenCalled();
  });
});

describe('form-action wrappers (discard result, log on failure)', () => {
  it('deactivateManagerAssignmentFormAction returns void on success', async () => {
    deactivateAssignment.mockResolvedValue({ ok: true, organizationId: 'org-1' });
    const result = await deactivateManagerAssignmentFormAction(fd({ assignmentId: 'a-1' }));
    expect(result).toBeUndefined();
    expect(deactivateAssignment).toHaveBeenCalled();
  });

  it('deactivateManagerAssignmentFormAction logs and swallows failure', async () => {
    deactivateAssignment.mockResolvedValue({ ok: false, reason: 'not_found' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await deactivateManagerAssignmentFormAction(fd({ assignmentId: 'bad' }));
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('reactivateManagerAssignmentFormAction returns void on success', async () => {
    reactivateAssignment.mockResolvedValue({ ok: true, organizationId: 'org-1' });
    const result = await reactivateManagerAssignmentFormAction(fd({ assignmentId: 'a-2' }));
    expect(result).toBeUndefined();
    expect(reactivateAssignment).toHaveBeenCalled();
  });

  it('reactivateManagerAssignmentFormAction logs and swallows failure', async () => {
    reactivateAssignment.mockResolvedValue({ ok: false, reason: 'not_found' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await reactivateManagerAssignmentFormAction(fd({ assignmentId: 'bad' }));
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
