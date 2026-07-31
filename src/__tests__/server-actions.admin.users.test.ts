import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdmin,
  createUser,
  updateUser,
  deactivateUser,
  reactivateUser,
  adminRegenerateBackupCodes,
  sendAdminUserInviteEmail,
  revalidatePath,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
  adminRegenerateBackupCodes: vi.fn(),
  sendAdminUserInviteEmail: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/email/send', () => ({ sendAdminUserInviteEmail }));

vi.mock('@/lib/services/admin/users', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/admin/users')>(
    '@/lib/services/admin/users'
  );
  return {
    ...actual,
    createUser,
    updateUser,
    deactivateUser,
    reactivateUser,
    adminRegenerateBackupCodes,
  };
});

import {
  createUserAction,
  updateUserAction,
  deactivateUserAction,
  reactivateUserAction,
  regenerateUserBackupCodesAction,
  updateUserFormAction,
  deactivateUserFormAction,
  reactivateUserFormAction,
} from '@/server-actions/admin/users';

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

describe('createUserAction', () => {
  it('returns validation error when email is missing — bare stable code, no zod details (R2)', async () => {
    const res = await createUserAction(fd({ email: '', name: 'Test', role: 'organization' }));
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('returns validation error when email is malformed', async () => {
    const res = await createUserAction(
      fd({ email: 'not-an-email', name: 'Test', role: 'organization' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('happy path returns ok:true with user and inviteUrl, sends email', async () => {
    process.env.APP_URL = 'https://app.test';
    createUser.mockResolvedValue({
      ok: true,
      user: { id: 'u-1', email: 'new@t.local', name: 'New User', role: 'organization' },
      inviteToken: 'tok-abc',
    });

    const res = await createUserAction(
      fd({ email: 'new@t.local', name: 'New User', role: 'organization' })
    );

    expect(res).toMatchObject({
      ok: true,
      user: { id: 'u-1', email: 'new@t.local' },
      inviteUrl: 'https://app.test/reset-password?token=tok-abc',
    });
    expect(sendAdminUserInviteEmail).toHaveBeenCalledWith({
      to: 'new@t.local',
      name: 'New User',
      role: 'organization',
      inviteUrl: 'https://app.test/reset-password?token=tok-abc',
      invitedByName: 'Admin User',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/users');

    delete process.env.APP_URL;
  });

  it('still returns ok:true when email send fails (graceful degradation)', async () => {
    createUser.mockResolvedValue({
      ok: true,
      user: { id: 'u-2', email: 'fail@t.local', name: 'Fail', role: 'partner' },
      inviteToken: 'tok-xyz',
    });
    sendAdminUserInviteEmail.mockRejectedValue(new Error('SMTP timeout'));

    const res = await createUserAction(
      fd({ email: 'fail@t.local', name: 'Fail', role: 'partner', partnerId: 'p-1' })
    );

    expect(res).toMatchObject({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/users');
  });

  it('uses undefined as invitedByName when session.name is absent', async () => {
    requireAdmin.mockResolvedValue({ sub: 'admin-1', name: null });
    createUser.mockResolvedValue({
      ok: true,
      user: { id: 'u-nn', email: 'nn@t.local', name: 'NN', role: 'organization' },
      inviteToken: 'tok-nn',
    });
    sendAdminUserInviteEmail.mockResolvedValue({ status: 'sent' });

    await createUserAction(fd({ email: 'nn@t.local', name: 'NN', role: 'organization' }));
    expect(sendAdminUserInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ invitedByName: undefined })
    );
  });

  it('maps service failure(duplicate_email) to Failure', async () => {
    createUser.mockResolvedValue({ ok: false, error: 'duplicate_email' });

    const res = await createUserAction(
      fd({ email: 'dup@t.local', name: 'Dup', role: 'organization' })
    );

    expect(res).toEqual({ ok: false, error: 'duplicate_email' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('maps service failure(admin_role_via_ui) to Failure', async () => {
    createUser.mockResolvedValue({ ok: false, error: 'admin_role_via_ui' });

    const res = await createUserAction(fd({ email: 'x@t.local', name: 'X', role: 'manager' }));

    expect(res).toEqual({ ok: false, error: 'admin_role_via_ui' });
  });
});

describe('updateUserAction', () => {
  it('happy path calls updateUser and revalidates both paths', async () => {
    updateUser.mockResolvedValue({ ok: true });

    const res = await updateUserAction(fd({ id: 'u-10', name: 'Updated Name' }));

    expect(res).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledWith(expect.anything(), 'admin-1', 'u-10', {
      name: 'Updated Name',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/users');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/users/u-10');
  });

  it('returns validation error when id is missing — bare stable code, no zod details (R2)', async () => {
    const res = await updateUserAction(fd({ id: '', name: 'X' }));
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('maps service failure(not_found) to Failure', async () => {
    updateUser.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await updateUserAction(fd({ id: 'gone-1', name: 'X' }));
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('maps service failure(self_action_forbidden) to Failure', async () => {
    updateUser.mockResolvedValue({ ok: false, error: 'self_action_forbidden' });
    const res = await updateUserAction(fd({ id: 'admin-1', role: 'partner' }));
    expect(res).toEqual({ ok: false, error: 'self_action_forbidden' });
  });
});

describe('deactivateUserAction', () => {
  it('happy path calls deactivateUser and revalidates', async () => {
    deactivateUser.mockResolvedValue({ ok: true });

    const res = await deactivateUserAction(fd({ id: 'u-20' }));

    expect(res).toEqual({ ok: true });
    expect(deactivateUser).toHaveBeenCalledWith(expect.anything(), 'admin-1', 'u-20');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/users');
  });

  it('returns validation error when id is missing', async () => {
    const res = await deactivateUserAction(fd({ id: '' }));
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(deactivateUser).not.toHaveBeenCalled();
  });

  it('maps service failure(last_admin_protected) to Failure', async () => {
    deactivateUser.mockResolvedValue({ ok: false, error: 'last_admin_protected' });
    const res = await deactivateUserAction(fd({ id: 'last-admin' }));
    expect(res).toEqual({ ok: false, error: 'last_admin_protected' });
  });
});

describe('reactivateUserAction', () => {
  it('happy path calls reactivateUser and revalidates', async () => {
    reactivateUser.mockResolvedValue({ ok: true });

    const res = await reactivateUserAction(fd({ id: 'u-30' }));

    expect(res).toEqual({ ok: true });
    expect(reactivateUser).toHaveBeenCalledWith(expect.anything(), 'admin-1', 'u-30');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/users');
  });

  it('returns validation error when id is missing', async () => {
    const res = await reactivateUserAction(fd({ id: '' }));
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(reactivateUser).not.toHaveBeenCalled();
  });

  it('maps service failure(not_found) to Failure', async () => {
    reactivateUser.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await reactivateUserAction(fd({ id: 'gone-2' }));
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('regenerateUserBackupCodesAction', () => {
  it('happy path returns the fresh codes from the service', async () => {
    adminRegenerateBackupCodes.mockResolvedValue({ ok: true, codes: ['A', 'B'] });
    const res = await regenerateUserBackupCodesAction(fd({ id: 'm-1' }));
    expect(res).toEqual({ ok: true, codes: ['A', 'B'] });
    expect(adminRegenerateBackupCodes).toHaveBeenCalledWith(expect.anything(), 'admin-1', 'm-1');
  });

  it('validation error when id is missing', async () => {
    const res = await regenerateUserBackupCodesAction(fd({ id: '' }));
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(adminRegenerateBackupCodes).not.toHaveBeenCalled();
  });

  it('maps not_staff failure through', async () => {
    adminRegenerateBackupCodes.mockResolvedValue({ ok: false, error: 'not_staff' });
    const res = await regenerateUserBackupCodesAction(fd({ id: 'p-1' }));
    expect(res).toEqual({ ok: false, error: 'not_staff' });
  });
});

describe('form-action wrappers (discard result, log on failure)', () => {
  it('updateUserFormAction returns void on success', async () => {
    updateUser.mockResolvedValue({ ok: true });
    const result = await updateUserFormAction(fd({ id: 'u-10', name: 'X' }));
    expect(result).toBeUndefined();
    expect(updateUser).toHaveBeenCalled();
  });

  it('updateUserFormAction logs and swallows failure', async () => {
    updateUser.mockResolvedValue({ ok: false, error: 'not_found' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await updateUserFormAction(fd({ id: 'gone', name: 'X' }));
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('deactivateUserFormAction returns void on success', async () => {
    deactivateUser.mockResolvedValue({ ok: true });
    const result = await deactivateUserFormAction(fd({ id: 'u-20' }));
    expect(result).toBeUndefined();
    expect(deactivateUser).toHaveBeenCalled();
  });

  it('deactivateUserFormAction logs and swallows failure', async () => {
    deactivateUser.mockResolvedValue({ ok: false, error: 'last_admin_protected' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await deactivateUserFormAction(fd({ id: 'last-admin' }));
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('reactivateUserFormAction returns void on success', async () => {
    reactivateUser.mockResolvedValue({ ok: true });
    const result = await reactivateUserFormAction(fd({ id: 'u-30' }));
    expect(result).toBeUndefined();
    expect(reactivateUser).toHaveBeenCalled();
  });

  it('reactivateUserFormAction logs and swallows failure', async () => {
    reactivateUser.mockResolvedValue({ ok: false, error: 'not_found' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await reactivateUserFormAction(fd({ id: 'gone' }));
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
