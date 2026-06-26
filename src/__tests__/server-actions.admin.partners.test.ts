import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdmin,
  createPartnerWithAdmin,
  updatePartner,
  deactivatePartner,
  reactivatePartner,
  sendAdminUserInviteEmail,
  revalidatePath
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createPartnerWithAdmin: vi.fn(),
  updatePartner: vi.fn(),
  deactivatePartner: vi.fn(),
  reactivatePartner: vi.fn(),
  sendAdminUserInviteEmail: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/email/send', () => ({ sendAdminUserInviteEmail }));

vi.mock('@/lib/services/admin/partners', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/services/admin/partners')>(
      '@/lib/services/admin/partners'
    );
  return {
    ...actual,
    createPartnerWithAdmin,
    updatePartner,
    deactivatePartner,
    reactivatePartner
  };
});

import {
  createPartnerWithAdminAction,
  updatePartnerAction,
  deactivatePartnerAction,
  reactivatePartnerAction,
  updatePartnerFormAction,
  deactivatePartnerFormAction,
  reactivatePartnerFormAction
} from '@/server-actions/admin/partners';
import { AdminPartnerError } from '@/lib/services/admin/partners';

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ sub: 'admin-1', name: 'Admin User' });
  sendAdminUserInviteEmail.mockResolvedValue({ status: 'sent', id: null });
});

describe('createPartnerWithAdminAction', () => {
  it('returns validation error when name is empty', async () => {
    const res = await createPartnerWithAdminAction(
      fd({ name: '', slug: 'valid-slug', adminEmail: 'admin@test.local', adminName: 'Admin' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(createPartnerWithAdmin).not.toHaveBeenCalled();
  });

  it('returns validation error when slug has uppercase letters', async () => {
    const res = await createPartnerWithAdminAction(
      fd({ name: 'Test', slug: 'Invalid-Slug', adminEmail: 'admin@test.local', adminName: 'Admin' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(createPartnerWithAdmin).not.toHaveBeenCalled();
  });

  it('returns validation error when slug has spaces', async () => {
    const res = await createPartnerWithAdminAction(
      fd({ name: 'Test', slug: 'invalid slug', adminEmail: 'admin@test.local', adminName: 'Admin' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(createPartnerWithAdmin).not.toHaveBeenCalled();
  });

  it('returns validation error when adminEmail is malformed', async () => {
    const res = await createPartnerWithAdminAction(
      fd({ name: 'Test', slug: 'valid-slug', adminEmail: 'not-an-email', adminName: 'Admin' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(createPartnerWithAdmin).not.toHaveBeenCalled();
  });

  it('happy path returns ok:true with partner, user and inviteUrl', async () => {
    process.env.APP_URL = 'https://app.test';
    createPartnerWithAdmin.mockResolvedValue({
      partner: { id: 'p-1', name: 'Test Partner', slug: 'test-partner' },
      user: { id: 'u-1', email: 'admin@partner.local' },
      inviteToken: 'tok-abc'
    });

    const res = await createPartnerWithAdminAction(
      fd({
        name: 'Test Partner',
        slug: 'test-partner',
        adminEmail: 'admin@partner.local',
        adminName: 'Partner Admin'
      })
    );

    expect(res).toMatchObject({
      ok: true,
      partner: { id: 'p-1', name: 'Test Partner', slug: 'test-partner' },
      user: { id: 'u-1', email: 'admin@partner.local' },
      inviteUrl: 'https://app.test/reset-password?token=tok-abc'
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/partners');

    delete process.env.APP_URL;
  });

  it('sends invite email with role:partner on success', async () => {
    process.env.APP_URL = 'https://app.test';
    createPartnerWithAdmin.mockResolvedValue({
      partner: { id: 'p-2', name: 'Email Partner', slug: 'email-partner' },
      user: { id: 'u-2', email: 'admin@email-partner.local' },
      inviteToken: 'tok-email'
    });

    await createPartnerWithAdminAction(
      fd({
        name: 'Email Partner',
        slug: 'email-partner',
        adminEmail: 'admin@email-partner.local',
        adminName: 'Email Admin'
      })
    );

    expect(sendAdminUserInviteEmail).toHaveBeenCalledWith({
      to: 'admin@email-partner.local',
      name: 'Email Admin',
      role: 'partner',
      inviteUrl: 'https://app.test/reset-password?token=tok-email',
      invitedByName: 'Admin User'
    });

    delete process.env.APP_URL;
  });

  it('still returns ok:true when email send fails (graceful degradation)', async () => {
    createPartnerWithAdmin.mockResolvedValue({
      partner: { id: 'p-3', name: 'Fail Partner', slug: 'fail-partner' },
      user: { id: 'u-3', email: 'fail@partner.local' },
      inviteToken: 'tok-fail'
    });
    sendAdminUserInviteEmail.mockRejectedValue(new Error('SMTP timeout'));

    const res = await createPartnerWithAdminAction(
      fd({
        name: 'Fail Partner',
        slug: 'fail-partner',
        adminEmail: 'fail@partner.local',
        adminName: 'Fail Admin'
      })
    );

    expect(res).toMatchObject({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/partners');
  });

  it('maps AdminPartnerError(duplicate_slug) to Failure', async () => {
    createPartnerWithAdmin.mockRejectedValue(new AdminPartnerError('duplicate_slug'));

    const res = await createPartnerWithAdminAction(
      fd({
        name: 'Dup Partner',
        slug: 'dup-slug',
        adminEmail: 'dup@partner.local',
        adminName: 'Dup Admin'
      })
    );

    expect(res).toEqual({ ok: false, error: 'duplicate_slug' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('maps AdminPartnerError(duplicate_email) to Failure', async () => {
    createPartnerWithAdmin.mockRejectedValue(new AdminPartnerError('duplicate_email'));

    const res = await createPartnerWithAdminAction(
      fd({
        name: 'Dup Email',
        slug: 'dup-email',
        adminEmail: 'existing@partner.local',
        adminName: 'Dup Admin'
      })
    );

    expect(res).toEqual({ ok: false, error: 'duplicate_email' });
  });

  it('converts form percentage to fraction before calling service (5 → 0.05)', async () => {
    createPartnerWithAdmin.mockResolvedValue({
      partner: { id: 'p-rate', name: 'P', slug: 'p-co' },
      user: { id: 'u-rate', email: 'a@x.test' },
      inviteToken: 'tok-rate'
    });

    await createPartnerWithAdminAction(
      fd({ name: 'P', slug: 'p-co', commissionRate: '5', adminEmail: 'a@x.test', adminName: 'Admin' })
    );

    expect(createPartnerWithAdmin).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ commissionRate: 0.05 })
    );
  });

  it('omits commissionRate when form field is empty (undefined → undefined)', async () => {
    createPartnerWithAdmin.mockResolvedValue({
      partner: { id: 'p-norat', name: 'P', slug: 'p-co' },
      user: { id: 'u-norat', email: 'a@x.test' },
      inviteToken: 'tok-norat'
    });

    await createPartnerWithAdminAction(
      fd({ name: 'P', slug: 'p-co', adminEmail: 'a@x.test', adminName: 'Admin' })
    );

    const args = createPartnerWithAdmin.mock.calls[0][2];
    expect(args.commissionRate).toBeUndefined();
  });
});

describe('createPartnerWithAdminAction — mapErr re-throw', () => {
  it('re-throws non-AdminPartnerError errors from the service', async () => {
    createPartnerWithAdmin.mockRejectedValue(new Error('DB connection reset'));
    await expect(
      createPartnerWithAdminAction(
        fd({ name: 'P', slug: 'p-co', adminEmail: 'a@test.local', adminName: 'Admin' })
      )
    ).rejects.toThrow('DB connection reset');
  });

  it('uses "https://lk.otsfera.ru" as APP_URL fallback when env is not set', async () => {
    const original = process.env.APP_URL;
    delete process.env.APP_URL;
    createPartnerWithAdmin.mockResolvedValue({
      partner: { id: 'p-fallback', name: 'P', slug: 'p-co' },
      user: { id: 'u-fallback', email: 'a@x.test' },
      inviteToken: 'tok-fallback'
    });

    const res = await createPartnerWithAdminAction(
      fd({ name: 'P', slug: 'p-co', adminEmail: 'a@x.test', adminName: 'Admin' })
    );
    expect(res).toMatchObject({ ok: true });
    expect((res as { ok: true; inviteUrl: string }).inviteUrl).toContain('https://lk.otsfera.ru');

    if (original !== undefined) process.env.APP_URL = original;
  });

  it('uses undefined as invitedByName when session.name is absent', async () => {
    requireAdmin.mockResolvedValue({ sub: 'admin-1', name: null });
    createPartnerWithAdmin.mockResolvedValue({
      partner: { id: 'p-nn', name: 'P', slug: 'p-co' },
      user: { id: 'u-nn', email: 'a@x.test' },
      inviteToken: 'tok-nn'
    });
    sendAdminUserInviteEmail.mockResolvedValue({ status: 'sent' });

    await createPartnerWithAdminAction(
      fd({ name: 'P', slug: 'p-co', adminEmail: 'a@x.test', adminName: 'Admin' })
    );
    expect(sendAdminUserInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ invitedByName: undefined })
    );
  });
});

describe('updatePartnerAction — mapErr re-throw', () => {
  it('re-throws non-AdminPartnerError errors from the service', async () => {
    updatePartner.mockRejectedValue(new Error('DB connection reset'));
    await expect(
      updatePartnerAction(fd({ id: 'p-1', name: 'X' }))
    ).rejects.toThrow('DB connection reset');
  });
});

describe('updatePartnerAction', () => {
  it('returns validation error when id is missing', async () => {
    const res = await updatePartnerAction(fd({ id: '', name: 'New Name' }));
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(updatePartner).not.toHaveBeenCalled();
  });

  it('happy path calls updatePartner and revalidates both paths', async () => {
    updatePartner.mockResolvedValue(undefined);

    const res = await updatePartnerAction(
      fd({ id: 'p-10', name: 'Updated Name' })
    );

    expect(res).toEqual({ ok: true });
    expect(updatePartner).toHaveBeenCalledWith(
      expect.anything(),
      'admin-1',
      'p-10',
      { name: 'Updated Name' }
    );
    expect(revalidatePath).toHaveBeenCalledWith('/admin/partners');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/partners/p-10');
  });

  it('maps AdminPartnerError(not_found) to Failure', async () => {
    updatePartner.mockRejectedValue(new AdminPartnerError('not_found'));
    const res = await updatePartnerAction(fd({ id: 'gone-1', name: 'X' }));
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('converts form percentage to fraction (5 → 0.05)', async () => {
    updatePartner.mockResolvedValue(undefined);

    await updatePartnerAction(fd({ id: 'p-1', commissionRate: '5' }));

    expect(updatePartner).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'p-1',
      expect.objectContaining({ commissionRate: 0.05 })
    );
  });

  it('passes empty commissionRate as undefined (clear rate → undefined)', async () => {
    updatePartner.mockResolvedValue(undefined);

    await updatePartnerAction(fd({ id: 'p-1', commissionRate: '' }));

    const args = updatePartner.mock.calls[0][3];
    // empty string → readField returns '' → || undefined → Zod optional → raw.commissionRate is undefined
    // undefined != null is false so the ternary passes undefined through unchanged
    expect(args.commissionRate).toBeUndefined();
  });

  it('threads a valid effectiveFrom through to updatePartner as a Date (A5 backdate)', async () => {
    updatePartner.mockResolvedValue(undefined);

    await updatePartnerAction(fd({ id: 'p-1', commissionRate: '10', effectiveFrom: '2026-04-15' }));

    expect(updatePartner).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'p-1',
      expect.objectContaining({ effectiveFrom: new Date('2026-04-15') })
    );
  });

  it('rejects an invalid effectiveFrom at validation (never reaches the service)', async () => {
    updatePartner.mockResolvedValue(undefined);

    const res = await updatePartnerAction(fd({ id: 'p-1', commissionRate: '10', effectiveFrom: 'not-a-date' }));

    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(updatePartner).not.toHaveBeenCalled();
  });
});

describe('deactivatePartnerAction', () => {
  it('returns validation error when id is missing', async () => {
    const res = await deactivatePartnerAction(fd({ id: '' }));
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(deactivatePartner).not.toHaveBeenCalled();
  });

  it('happy path calls deactivatePartner and revalidates list + detail', async () => {
    deactivatePartner.mockResolvedValue(undefined);

    const res = await deactivatePartnerAction(fd({ id: 'p-20' }));

    expect(res).toEqual({ ok: true });
    expect(deactivatePartner).toHaveBeenCalledWith(expect.anything(), 'admin-1', 'p-20');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/partners');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/partners/p-20');
  });

  it('maps AdminPartnerError(not_found) to Failure', async () => {
    deactivatePartner.mockRejectedValue(new AdminPartnerError('not_found'));
    const res = await deactivatePartnerAction(fd({ id: 'gone-2' }));
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('reactivatePartnerAction', () => {
  it('returns validation error when id is missing', async () => {
    const res = await reactivatePartnerAction(fd({ id: '' }));
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(reactivatePartner).not.toHaveBeenCalled();
  });

  it('happy path calls reactivatePartner and revalidates list + detail', async () => {
    reactivatePartner.mockResolvedValue(undefined);

    const res = await reactivatePartnerAction(fd({ id: 'p-30' }));

    expect(res).toEqual({ ok: true });
    expect(reactivatePartner).toHaveBeenCalledWith(expect.anything(), 'admin-1', 'p-30');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/partners');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/partners/p-30');
  });

  it('maps AdminPartnerError(not_found) to Failure', async () => {
    reactivatePartner.mockRejectedValue(new AdminPartnerError('not_found'));
    const res = await reactivatePartnerAction(fd({ id: 'gone-3' }));
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('form-action wrappers (discard result, log on failure)', () => {
  it('updatePartnerFormAction returns void on success', async () => {
    updatePartner.mockResolvedValue(undefined);
    const result = await updatePartnerFormAction(fd({ id: 'p-10', name: 'X' }));
    expect(result).toBeUndefined();
    expect(updatePartner).toHaveBeenCalled();
  });

  it('updatePartnerFormAction logs and swallows failure', async () => {
    updatePartner.mockRejectedValue(new AdminPartnerError('not_found'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await updatePartnerFormAction(fd({ id: 'gone', name: 'X' }));
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('deactivatePartnerFormAction returns void on success', async () => {
    deactivatePartner.mockResolvedValue(undefined);
    const result = await deactivatePartnerFormAction(fd({ id: 'p-20' }));
    expect(result).toBeUndefined();
    expect(deactivatePartner).toHaveBeenCalled();
  });

  it('deactivatePartnerFormAction logs and swallows failure', async () => {
    deactivatePartner.mockRejectedValue(new AdminPartnerError('not_found'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await deactivatePartnerFormAction(fd({ id: 'gone' }));
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('reactivatePartnerFormAction returns void on success', async () => {
    reactivatePartner.mockResolvedValue(undefined);
    const result = await reactivatePartnerFormAction(fd({ id: 'p-30' }));
    expect(result).toBeUndefined();
    expect(reactivatePartner).toHaveBeenCalled();
  });

  it('reactivatePartnerFormAction logs and swallows failure', async () => {
    reactivatePartner.mockRejectedValue(new AdminPartnerError('not_found'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await reactivatePartnerFormAction(fd({ id: 'gone' }));
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
