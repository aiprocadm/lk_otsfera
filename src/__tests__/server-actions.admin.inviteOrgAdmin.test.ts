import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdmin,
  createOrgAdminInvite,
  sendOrgInviteEmail,
  revalidatePath,
  organizationFindUnique
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createOrgAdminInvite: vi.fn(),
  sendOrgInviteEmail: vi.fn(),
  revalidatePath: vi.fn(),
  organizationFindUnique: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
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
  return { ...actual, createOrgAdminInvite };
});

import { inviteAdminOrgAdminAction } from '@/server-actions/admin/inviteOrgAdmin';
import { OrgInviteError } from '@/lib/services/organization/invite';

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
      alreadyHasPassword: false
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

  it('returns validation on bad email', async () => {
    const res = await inviteAdminOrgAdminAction(
      fd({ organizationId: 'o', email: 'bad', name: 'X' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
  });

  it('maps OrgInviteError(not_found)', async () => {
    createOrgAdminInvite.mockRejectedValue(new OrgInviteError('not_found'));
    const res = await inviteAdminOrgAdminAction(
      fd({ organizationId: 'missing', email: 'x@t.local', name: 'X' })
    );
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});
