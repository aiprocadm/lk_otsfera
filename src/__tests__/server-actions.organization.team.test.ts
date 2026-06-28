import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireOrganizationAdmin,
  requireOrganizationAdminOrLeader,
  isOrgAdmin,
  inviteMember,
  updateMemberRole,
  deactivateMember,
  reactivateMember,
  sendOrgInviteEmail,
  revalidatePath,
  organizationFindUnique
} = vi.hoisted(() => ({
  requireOrganizationAdmin: vi.fn(),
  requireOrganizationAdminOrLeader: vi.fn(),
  isOrgAdmin: vi.fn(),
  inviteMember: vi.fn(),
  updateMemberRole: vi.fn(),
  deactivateMember: vi.fn(),
  reactivateMember: vi.fn(),
  sendOrgInviteEmail: vi.fn(),
  revalidatePath: vi.fn(),
  organizationFindUnique: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireOrganizationAdmin, requireOrganizationAdminOrLeader }));
vi.mock('@/lib/auth/organizationPolicy', () => ({ isOrgAdmin }));
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
  reactivateOrgMemberAction,
  updateOrgMemberRoleFormAction,
  deactivateOrgMemberFormAction,
  reactivateOrgMemberFormAction
} from '@/server-actions/organization/team';

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  const adminSession = {
    sub: 'actor-1',
    name: 'Actor',
    organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'admin', isActive: true }]
  };
  requireOrganizationAdmin.mockResolvedValue(adminSession);
  requireOrganizationAdminOrLeader.mockResolvedValue(adminSession);
  isOrgAdmin.mockReturnValue(true);
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
      ok: true,
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
      ok: true,
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

  it('maps already_member Result to {ok:false, error:already_member}', async () => {
    inviteMember.mockResolvedValue({ ok: false, error: 'already_member' });
    const res = await inviteOrgMemberAction(
      fd({ organizationId: 'org-1', email: 'dup@t.local', name: 'D', roleInOrg: 'member' })
    );
    expect(res).toEqual({ ok: false, error: 'already_member' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('updateOrgMemberRoleAction', () => {
  it('calls updateMemberRole and revalidates', async () => {
    updateMemberRole.mockResolvedValue({ ok: true });
    const res = await updateOrgMemberRoleAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1', newRole: 'admin' })
    );
    expect(res).toEqual({ ok: true });
    expect(updateMemberRole).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'ou-1',
      'admin',
      'actor-1',
      'admin'
    );
    expect(revalidatePath).toHaveBeenCalledWith('/organization/team');
  });

  it('maps self_action_forbidden', async () => {
    updateMemberRole.mockResolvedValue({ ok: false, error: 'self_action_forbidden' });
    const res = await updateOrgMemberRoleAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1', newRole: 'member' })
    );
    expect(res).toEqual({ ok: false, error: 'self_action_forbidden' });
  });

  it('maps last_admin_protected', async () => {
    updateMemberRole.mockResolvedValue({ ok: false, error: 'last_admin_protected' });
    const res = await updateOrgMemberRoleAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1', newRole: 'member' })
    );
    expect(res).toEqual({ ok: false, error: 'last_admin_protected' });
  });
});

describe('deactivateOrgMemberAction', () => {
  it('calls deactivateMember and revalidates', async () => {
    deactivateMember.mockResolvedValue({ ok: true });
    const res = await deactivateOrgMemberAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1' })
    );
    expect(res).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/organization/team');
  });

  it('maps not_found', async () => {
    deactivateMember.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await deactivateOrgMemberAction(
      fd({ organizationId: 'org-1', orgUserId: 'gone' })
    );
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('reactivateOrgMemberAction', () => {
  it('calls reactivateMember and revalidates', async () => {
    reactivateMember.mockResolvedValue({ ok: true });
    const res = await reactivateOrgMemberAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1' })
    );
    expect(res).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/organization/team');
  });
});

describe('inviteOrgMemberAction — email failure (graceful degradation)', () => {
  it('still returns ok:true when sendOrgInviteEmail throws', async () => {
    organizationFindUnique.mockResolvedValue({ name: 'ООО Тест' });
    inviteMember.mockResolvedValue({
      ok: true,
      user: { id: 'u3', email: 'new2@t.local' },
      inviteUrl: 'https://app.test/reset-password?token=def',
      alreadyHasPassword: false
    });
    sendOrgInviteEmail.mockRejectedValue(new Error('SMTP down'));

    const res = await inviteOrgMemberAction(
      fd({ organizationId: 'org-1', email: 'new2@t.local', name: 'N', roleInOrg: 'member' })
    );
    expect(res).toMatchObject({ ok: true, inviteUrl: 'https://app.test/reset-password?token=def' });
    expect(revalidatePath).toHaveBeenCalledWith('/organization/team');
  });
});

describe('updateOrgMemberRoleAction — validation branch', () => {
  it('returns validation when organizationId is empty', async () => {
    const res = await updateOrgMemberRoleAction(
      fd({ organizationId: '', orgUserId: 'ou-1', newRole: 'member' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(updateMemberRole).not.toHaveBeenCalled();
  });

  it('returns validation when newRole is invalid', async () => {
    const res = await updateOrgMemberRoleAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1', newRole: 'superadmin' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(updateMemberRole).not.toHaveBeenCalled();
  });
});

describe('deactivateOrgMemberAction — validation branch', () => {
  it('returns validation when orgUserId is empty', async () => {
    const res = await deactivateOrgMemberAction(
      fd({ organizationId: 'org-1', orgUserId: '' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(deactivateMember).not.toHaveBeenCalled();
  });
});

describe('reactivateOrgMemberAction — validation + error mapping', () => {
  it('returns validation when orgUserId is empty', async () => {
    const res = await reactivateOrgMemberAction(
      fd({ organizationId: 'org-1', orgUserId: '' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(reactivateMember).not.toHaveBeenCalled();
  });

  it('maps not_found Result to {ok:false, error:not_found}', async () => {
    reactivateMember.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await reactivateOrgMemberAction(
      fd({ organizationId: 'org-1', orgUserId: 'gone' })
    );
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('form-action wrappers (discard result, log on failure)', () => {
  it('updateOrgMemberRoleFormAction returns void on success', async () => {
    updateMemberRole.mockResolvedValue({ ok: true });
    const result = await updateOrgMemberRoleFormAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1', newRole: 'member' })
    );
    expect(result).toBeUndefined();
    expect(updateMemberRole).toHaveBeenCalled();
  });

  it('updateOrgMemberRoleFormAction logs and swallows failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    updateMemberRole.mockResolvedValue({ ok: false, error: 'not_found' });
    const result = await updateOrgMemberRoleFormAction(
      fd({ organizationId: 'org-1', orgUserId: 'gone', newRole: 'member' })
    );
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('deactivateOrgMemberFormAction returns void on success', async () => {
    deactivateMember.mockResolvedValue({ ok: true });
    const result = await deactivateOrgMemberFormAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1' })
    );
    expect(result).toBeUndefined();
    expect(deactivateMember).toHaveBeenCalled();
  });

  it('deactivateOrgMemberFormAction logs and swallows failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deactivateMember.mockResolvedValue({ ok: false, error: 'not_found' });
    const result = await deactivateOrgMemberFormAction(
      fd({ organizationId: 'org-1', orgUserId: 'gone' })
    );
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('reactivateOrgMemberFormAction returns void on success', async () => {
    reactivateMember.mockResolvedValue({ ok: true });
    const result = await reactivateOrgMemberFormAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1' })
    );
    expect(result).toBeUndefined();
    expect(reactivateMember).toHaveBeenCalled();
  });

  it('reactivateOrgMemberFormAction logs and swallows failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reactivateMember.mockResolvedValue({ ok: false, error: 'not_found' });
    const result = await reactivateOrgMemberFormAction(
      fd({ organizationId: 'org-1', orgUserId: 'gone' })
    );
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('inviteOrgMemberAction — null/fallback branches', () => {
  it('uses "member" as roleInOrg fallback when key is absent from FormData', async () => {
    // When roleInOrg key is absent: formData.get('roleInOrg') returns null
    // → readFormValue returns '' → '' || 'member' → 'member'
    inviteMember.mockResolvedValue({
      ok: true,
      user: { id: 'uf', email: 'f@t.local' },
      inviteUrl: null,
      alreadyHasPassword: true
    });
    const formWithoutRole = new FormData();
    formWithoutRole.append('organizationId', 'org-1');
    formWithoutRole.append('email', 'f@t.local');
    formWithoutRole.append('name', 'Fallback');
    // No 'roleInOrg' key — will use the || 'member' fallback
    const res = await inviteOrgMemberAction(formWithoutRole);
    expect(res).toMatchObject({ ok: true });
    expect(inviteMember).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ roleInOrg: 'member' }),
      'actor-1',
      { source: 'organization' },
      'admin'
    );
  });

  it('uses "организация" fallback when org lookup returns null during email', async () => {
    organizationFindUnique.mockResolvedValue(null);
    inviteMember.mockResolvedValue({
      ok: true,
      user: { id: 'u-null-org', email: 'no@t.local' },
      inviteUrl: 'https://app/reset?token=qq',
      alreadyHasPassword: false
    });
    sendOrgInviteEmail.mockResolvedValue({ status: 'sent' });

    const res = await inviteOrgMemberAction(
      fd({ organizationId: 'org-gone', email: 'no@t.local', name: 'N', roleInOrg: 'member' })
    );
    expect(res).toMatchObject({ ok: true });
    expect(sendOrgInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ organizationName: 'организация' })
    );
  });

  it('uses undefined as invitedByName when session.name is absent', async () => {
    requireOrganizationAdminOrLeader.mockResolvedValue({
      sub: 'actor-1',
      name: null,
      organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'admin', isActive: true }]
    });
    organizationFindUnique.mockResolvedValue({ name: 'ООО Тест' });
    inviteMember.mockResolvedValue({
      ok: true,
      user: { id: 'u-nn', email: 'nn@t.local' },
      inviteUrl: 'https://app/reset?token=nn',
      alreadyHasPassword: false
    });
    sendOrgInviteEmail.mockResolvedValue({ status: 'sent' });

    await inviteOrgMemberAction(
      fd({ organizationId: 'org-1', email: 'nn@t.local', name: 'N', roleInOrg: 'member' })
    );
    expect(sendOrgInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ invitedByName: undefined })
    );
  });

  it('re-throws non-domain errors from inviteMember', async () => {
    inviteMember.mockRejectedValue(new Error('DB crash'));
    await expect(
      inviteOrgMemberAction(fd({ organizationId: 'org-1', email: 'x@t.local', name: 'X', roleInOrg: 'member' }))
    ).rejects.toThrow('DB crash');
  });
});

describe('actorRole leader arm (isOrgAdmin=false) for invite/deactivate/reactivate', () => {
  it('inviteOrgMemberAction passes actorRole="leader" when actor is a leader', async () => {
    isOrgAdmin.mockReturnValue(false);
    inviteMember.mockResolvedValue({
      ok: true,
      user: { id: 'u-ldr', email: 'ldr@t.local' },
      inviteUrl: null,
      alreadyHasPassword: true
    });
    const res = await inviteOrgMemberAction(
      fd({ organizationId: 'org-1', email: 'ldr@t.local', name: 'L', roleInOrg: 'member' })
    );
    expect(res).toMatchObject({ ok: true });
    expect(inviteMember).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'actor-1',
      { source: 'organization' },
      'leader'
    );
  });

  it('deactivateOrgMemberAction passes actorRole="leader" when actor is a leader', async () => {
    isOrgAdmin.mockReturnValue(false);
    deactivateMember.mockResolvedValue({ ok: true });
    const res = await deactivateOrgMemberAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1' })
    );
    expect(res).toEqual({ ok: true });
    expect(deactivateMember).toHaveBeenCalledWith(
      expect.anything(), 'org-1', 'ou-1', 'actor-1', 'leader'
    );
  });

  it('reactivateOrgMemberAction passes actorRole="leader" when actor is a leader', async () => {
    isOrgAdmin.mockReturnValue(false);
    reactivateMember.mockResolvedValue({ ok: true });
    const res = await reactivateOrgMemberAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-1' })
    );
    expect(res).toEqual({ ok: true });
    expect(reactivateMember).toHaveBeenCalledWith(
      expect.anything(), 'org-1', 'ou-1', 'actor-1', 'leader'
    );
  });
});

describe('leader actor threads actorRole', () => {
  it('passes actorRole="leader" to updateMemberRole when actor is a leader', async () => {
    requireOrganizationAdminOrLeader.mockResolvedValue({
      sub: 'leader-1',
      organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'leader', isActive: true }]
    });
    isOrgAdmin.mockReturnValue(false);
    updateMemberRole.mockResolvedValue({ ok: true });

    const res = await updateOrgMemberRoleAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-9', newRole: 'leader' })
    );
    expect(res).toEqual({ ok: true });
    expect(updateMemberRole).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'ou-9',
      'leader',
      'leader-1',
      'leader'
    );
  });

  it('maps requires_admin error to {ok:false, error:requires_admin}', async () => {
    requireOrganizationAdminOrLeader.mockResolvedValue({
      sub: 'leader-1',
      organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'leader', isActive: true }]
    });
    isOrgAdmin.mockReturnValue(false);
    updateMemberRole.mockResolvedValue({ ok: false, error: 'requires_admin' });

    const res = await updateOrgMemberRoleAction(
      fd({ organizationId: 'org-1', orgUserId: 'ou-9', newRole: 'admin' })
    );
    expect(res).toEqual({ ok: false, error: 'requires_admin' });
  });

  it('accepts roleInOrg=leader in the invite schema and passes actorRole', async () => {
    inviteMember.mockResolvedValue({
      ok: true,
      user: { id: 'u', email: 'l@t.local' },
      inviteUrl: null,
      alreadyHasPassword: true
    });
    const res = await inviteOrgMemberAction(
      fd({ organizationId: 'org-1', email: 'l@t.local', name: 'L', roleInOrg: 'leader' })
    );
    expect(res).toMatchObject({ ok: true });
    expect(inviteMember).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ roleInOrg: 'leader' }),
      'actor-1',
      { source: 'organization' },
      'admin'
    );
  });
});
