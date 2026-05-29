import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireOrganizationAdmin,
  inviteMember,
  updateMemberRole,
  deactivateMember,
  reactivateMember,
  sendOrgInviteEmail,
  revalidatePath,
  organizationFindUnique
} = vi.hoisted(() => ({
  requireOrganizationAdmin: vi.fn(),
  inviteMember: vi.fn(),
  updateMemberRole: vi.fn(),
  deactivateMember: vi.fn(),
  reactivateMember: vi.fn(),
  sendOrgInviteEmail: vi.fn(),
  revalidatePath: vi.fn(),
  organizationFindUnique: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireOrganizationAdmin }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { organization: { findUnique: organizationFindUnique } }
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/email/send', () => ({ sendOrgInviteEmail }));

// Import the real team service so the OrgMemberError class is the same module
// instance the SUT throws against. Only the four service functions are
// stubbed out via the partial mock.
vi.mock('@/lib/services/organization/team', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/services/organization/team')>(
      '@/lib/services/organization/team'
    );
  return {
    ...actual,
    inviteMember,
    updateMemberRole,
    deactivateMember,
    reactivateMember
  };
});

import {
  inviteOrgMemberAction,
  updateOrgMemberRoleAction,
  deactivateOrgMemberAction,
  reactivateOrgMemberAction
} from '@/server-actions/organization/team';
import { OrgMemberError } from '@/lib/services/organization/team';

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOrganizationAdmin.mockResolvedValue({ sub: 'actor-1', name: 'Actor' });
});

describe('inviteOrgMemberAction', () => {
  it('returns validation when email is malformed', async () => {
    const res = await inviteOrgMemberAction(
      fd({ organizationId: 'org-1', email: 'not-an-email', name: 'X', roleInOrg: 'member' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(inviteMember).not.toHaveBeenCalled();
  });

  it('happy path returns inviteUrl and sends email when invite token created', async () => {
    organizationFindUnique.mockResolvedValue({ name: 'ООО Тест' });
    inviteMember.mockResolvedValue({
      user: { id: 'u1', email: 'new@t.local' },
      inviteUrl: 'https://app.test/reset-password?token=abc',
      alreadyHasPassword: false
    });

    const res = await inviteOrgMemberAction(
      fd({ organizationId: 'org-1', email: 'new@t.local', name: 'New', roleInOrg: 'admin' })
    );
    expect(res).toMatchObject({
      ok: true,
      inviteUrl: 'https://app.test/reset-password?token=abc',
      alreadyHasPassword: false
    });
    expect(sendOrgInviteEmail).toHaveBeenCalledWith({
      to: 'new@t.local',
      organizationName: 'ООО Тест',
      inviteUrl: 'https://app.test/reset-password?token=abc',
      invitedByName: 'Actor'
    });
    expect(revalidatePath).toHaveBeenCalledWith('/organization/team');
  });

  it('skips email when user already has password (inviteUrl null)', async () => {
    inviteMember.mockResolvedValue({
      user: { id: 'u2', email: 'existing@t.local' },
      inviteUrl: null,
      alreadyHasPassword: true
    });

    const res = await inviteOrgMemberAction(
      fd({
        organizationId: 'org-1',
        email: 'existing@t.local',
        name: 'Existing',
        roleInOrg: 'member'
      })
    );
    expect(res).toMatchObject({ ok: true, alreadyHasPassword: true, inviteUrl: null });
    expect(sendOrgInviteEmail).not.toHaveBeenCalled();
  });

  it('maps OrgMemberError(already_member) to {ok:false, error:already_member}', async () => {
    inviteMember.mockRejectedValue(new OrgMemberError('already_member'));
    const res = await inviteOrgMemberAction(
      fd({ organizationId: 'org-1', email: 'dup@t.local', name: 'D', roleInOrg: 'member' })
    );
    expect(res).toEqual({ ok: false, error: 'already_member' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('updateOrgMemberRoleAction', () => {
  it('calls updateMemberRole and revalidates', async () => {
    updateMemberRole.mockResolvedValue(undefined);
    const res = await updateOrgMemberRoleAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1', newRole: 'admin' })
    );
    expect(res).toEqual({ ok: true });
    expect(updateMemberRole).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'ou-1',
      'admin',
      'actor-1'
    );
    expect(revalidatePath).toHaveBeenCalledWith('/organization/team');
  });

  it('maps self_action_forbidden', async () => {
    updateMemberRole.mockRejectedValue(new OrgMemberError('self_action_forbidden'));
    const res = await updateOrgMemberRoleAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1', newRole: 'member' })
    );
    expect(res).toEqual({ ok: false, error: 'self_action_forbidden' });
  });

  it('maps last_admin_protected', async () => {
    updateMemberRole.mockRejectedValue(new OrgMemberError('last_admin_protected'));
    const res = await updateOrgMemberRoleAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1', newRole: 'member' })
    );
    expect(res).toEqual({ ok: false, error: 'last_admin_protected' });
  });
});

describe('deactivateOrgMemberAction', () => {
  it('calls deactivateMember and revalidates', async () => {
    deactivateMember.mockResolvedValue(undefined);
    const res = await deactivateOrgMemberAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1' })
    );
    expect(res).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/organization/team');
  });

  it('maps not_found', async () => {
    deactivateMember.mockRejectedValue(new OrgMemberError('not_found'));
    const res = await deactivateOrgMemberAction(
      fd({ organizationId: 'org-1', orgUserId: 'gone' })
    );
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('reactivateOrgMemberAction', () => {
  it('calls reactivateMember and revalidates', async () => {
    reactivateMember.mockResolvedValue(undefined);
    const res = await reactivateOrgMemberAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1' })
    );
    expect(res).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/organization/team');
  });
});
