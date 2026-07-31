import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdmin,
  createOrgAdminInvite,
  sendOrgInviteEmail,
  revalidatePath,
  organizationFindUnique,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createOrgAdminInvite: vi.fn(),
  sendOrgInviteEmail: vi.fn(),
  revalidatePath: vi.fn(),
  organizationFindUnique: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { organization: { findUnique: organizationFindUnique } },
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/email/send', () => ({ sendOrgInviteEmail }));
vi.mock('@/lib/services/organization/invite', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/organization/invite')>(
    '@/lib/services/organization/invite'
  );
  return { ...actual, createOrgAdminInvite };
});

import { inviteAdminOrgAdminAction } from '@/server-actions/admin/inviteOrgAdmin';
import { OrgInviteError } from '@/lib/services/organization/invite';
import { OrgMemberError } from '@/lib/services/organization/team';

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ sub: 'admin-1', name: 'Plat Admin' });
});

describe('inviteAdminOrgAdminAction', () => {
  it('passes source=platform_admin and no actorPartnerId', async () => {
    organizationFindUnique.mockResolvedValue({ name: 'ООО Тест' });
    createOrgAdminInvite.mockResolvedValue({
      user: { id: 'u-1', email: 'cust@t.local' },
      inviteUrl: 'https://app/reset-password?token=xyz',
      alreadyHasPassword: false,
    });

    const res = await inviteAdminOrgAdminAction(
      fd({ organizationId: 'any-org', email: 'cust@t.local', name: 'Customer' })
    );
    expect(res.ok).toBe(true);
    expect(createOrgAdminInvite).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'any-org', email: 'cust@t.local', name: 'Customer' },
      { actorUserId: 'admin-1', source: 'platform_admin' }
    );
    expect(revalidatePath).toHaveBeenCalledWith('/admin/organizations/any-org');
  });

  it('returns validation on bad email — bare stable code, no zod details (R2)', async () => {
    const res = await inviteAdminOrgAdminAction(
      fd({ organizationId: 'o', email: 'bad', name: 'X' })
    );
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it('returns validation when form is completely empty (readFormValue null branch)', async () => {
    // When keys are absent: formData.get(key) returns null → typeof null === 'string' is false → ''
    // This covers the readFormValue false branch at line 37
    const res = await inviteAdminOrgAdminAction(new FormData());
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(createOrgAdminInvite).not.toHaveBeenCalled();
  });

  it('maps OrgInviteError(not_found)', async () => {
    createOrgAdminInvite.mockRejectedValue(new OrgInviteError('not_found'));
    const res = await inviteAdminOrgAdminAction(
      fd({ organizationId: 'missing', email: 'x@t.local', name: 'X' })
    );
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('maps OrgMemberError(already_member) from underlying invite flow', async () => {
    createOrgAdminInvite.mockRejectedValue(new OrgMemberError('already_member'));
    const res = await inviteAdminOrgAdminAction(
      fd({ organizationId: 'org-1', email: 'dup@t.local', name: 'Dup' })
    );
    expect(res).toEqual({ ok: false, error: 'already_member' });
  });

  it('skips email when inviteUrl is null (user already has password)', async () => {
    createOrgAdminInvite.mockResolvedValue({
      user: { id: 'u-exist', email: 'exist@t.local' },
      inviteUrl: null,
      alreadyHasPassword: true,
    });

    const res = await inviteAdminOrgAdminAction(
      fd({ organizationId: 'org-1', email: 'exist@t.local', name: 'Exist' })
    );
    expect(res).toMatchObject({ ok: true, inviteUrl: null, alreadyHasPassword: true });
    expect(sendOrgInviteEmail).not.toHaveBeenCalled();
  });

  it('still returns ok:true when sendOrgInviteEmail throws (graceful degradation)', async () => {
    organizationFindUnique.mockResolvedValue({ name: 'ООО Тест' });
    createOrgAdminInvite.mockResolvedValue({
      user: { id: 'u-new', email: 'new@t.local' },
      inviteUrl: 'https://app/reset-password?token=xyz',
      alreadyHasPassword: false,
    });
    sendOrgInviteEmail.mockRejectedValue(new Error('SMTP error'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await inviteAdminOrgAdminAction(
      fd({ organizationId: 'org-1', email: 'new@t.local', name: 'New' })
    );
    expect(res).toMatchObject({ ok: true, inviteUrl: 'https://app/reset-password?token=xyz' });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('uses fallback "организация" when org is not found during email send', async () => {
    organizationFindUnique.mockResolvedValue(null);
    createOrgAdminInvite.mockResolvedValue({
      user: { id: 'u-new2', email: 'new2@t.local' },
      inviteUrl: 'https://app/reset-password?token=abc',
      alreadyHasPassword: false,
    });
    sendOrgInviteEmail.mockResolvedValue({ status: 'sent' });

    const res = await inviteAdminOrgAdminAction(
      fd({ organizationId: 'org-missing', email: 'new2@t.local', name: 'New' })
    );
    expect(res).toMatchObject({ ok: true });
    expect(sendOrgInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ organizationName: 'организация' })
    );
  });

  it('uses undefined invitedByName when session.name is absent', async () => {
    requireAdmin.mockResolvedValue({ sub: 'admin-1', name: null });
    organizationFindUnique.mockResolvedValue({ name: 'ООО Тест' });
    createOrgAdminInvite.mockResolvedValue({
      user: { id: 'u-3', email: 'new3@t.local' },
      inviteUrl: 'https://app/reset-password?token=ghi',
      alreadyHasPassword: false,
    });
    sendOrgInviteEmail.mockResolvedValue({ status: 'sent' });

    await inviteAdminOrgAdminAction(
      fd({ organizationId: 'org-1', email: 'new3@t.local', name: 'N' })
    );
    expect(sendOrgInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ invitedByName: undefined })
    );
  });

  it('re-throws non-domain errors', async () => {
    createOrgAdminInvite.mockRejectedValue(new Error('DB down'));
    await expect(
      inviteAdminOrgAdminAction(fd({ organizationId: 'org-1', email: 'x@t.local', name: 'X' }))
    ).rejects.toThrow('DB down');
  });
});
