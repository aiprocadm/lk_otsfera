import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requirePartnerAdmin,
  createOrgAdminInvite,
  sendOrgInviteEmail,
  revalidatePath,
  organizationFindUnique
} = vi.hoisted(() => ({
  requirePartnerAdmin: vi.fn(),
  createOrgAdminInvite: vi.fn(),
  sendOrgInviteEmail: vi.fn(),
  revalidatePath: vi.fn(),
  organizationFindUnique: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requirePartnerAdmin }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { organization: { findUnique: organizationFindUnique } }
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/email/send', () => ({ sendOrgInviteEmail }));
vi.mock('@/lib/services/organization/invite', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/services/organization/invite')>(
      '@/lib/services/organization/invite'
    );
  return {
    ...actual,
    createOrgAdminInvite
  };
});

import { invitePartnerOrgAdminAction } from '@/server-actions/partner/inviteOrgAdmin';
import { OrgInviteError } from '@/lib/services/organization/invite';
import { OrgMemberError } from '@/lib/services/organization/team';

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePartnerAdmin.mockResolvedValue({
    sub: 'partner-actor-1',
    partnerId: 'partner-1',
    name: 'Partner Admin'
  });
});

describe('invitePartnerOrgAdminAction', () => {
  it('returns validation on bad email', async () => {
    const res = await invitePartnerOrgAdminAction(
      fd({ organizationId: 'org-1', email: 'not-email', name: 'X' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(createOrgAdminInvite).not.toHaveBeenCalled();
  });

  it('happy path passes actorPartnerId from session and sends email', async () => {
    organizationFindUnique.mockResolvedValue({ name: 'ООО Клиент' });
    createOrgAdminInvite.mockResolvedValue({
      user: { id: 'u-new', email: 'cust@t.local' },
      inviteUrl: 'https://app.test/reset-password?token=abc',
      alreadyHasPassword: false
    });

    const res = await invitePartnerOrgAdminAction(
      fd({ organizationId: 'org-1', email: 'cust@t.local', name: 'Customer' })
    );

    expect(res).toMatchObject({ ok: true, inviteUrl: expect.any(String) });
    expect(createOrgAdminInvite).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org-1', email: 'cust@t.local', name: 'Customer' },
      {
        actorUserId: 'partner-actor-1',
        source: 'partner',
        actorPartnerId: 'partner-1'
      }
    );
    expect(sendOrgInviteEmail).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/partner/portfolio/org-1');
  });

  it('maps OrgInviteError(forbidden) when service rejects partner scope', async () => {
    createOrgAdminInvite.mockRejectedValue(new OrgInviteError('forbidden'));
    const res = await invitePartnerOrgAdminAction(
      fd({ organizationId: 'foreign-org', email: 'x@t.local', name: 'X' })
    );
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('maps OrgMemberError(already_member) from underlying invite flow', async () => {
    createOrgAdminInvite.mockRejectedValue(new OrgMemberError('already_member'));
    const res = await invitePartnerOrgAdminAction(
      fd({ organizationId: 'org-1', email: 'dup@t.local', name: 'D' })
    );
    expect(res).toEqual({ ok: false, error: 'already_member' });
  });

  it('returns forbidden when session has no partnerId', async () => {
    requirePartnerAdmin.mockResolvedValue({ sub: 'x', partnerId: null, name: 'X' });
    const res = await invitePartnerOrgAdminAction(
      fd({ organizationId: 'org-1', email: 'x@t.local', name: 'X' })
    );
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(createOrgAdminInvite).not.toHaveBeenCalled();
  });
});
