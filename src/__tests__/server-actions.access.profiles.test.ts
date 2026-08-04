import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireSession,
  revalidatePath,
  createAccessProfile,
  updateAccessProfile,
  deleteAccessProfile,
  assignUserProfile,
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  createAccessProfile: vi.fn(),
  updateAccessProfile: vi.fn(),
  deleteAccessProfile: vi.fn(),
  assignUserProfile: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/access/profiles', () => ({
  createAccessProfile,
  updateAccessProfile,
  deleteAccessProfile,
  assignUserProfile,
}));

import {
  createAccessProfileAction,
  updateAccessProfileAction,
  deleteAccessProfileAction,
  assignUserProfileAction,
} from '@/server-actions/access/profiles';

const SESSION = { sub: 'u1', role: 'manager', managerRole: 'leader', companyId: 'co-A' };

function profileForm(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('name', over.name ?? 'Оператор');
  for (const k of ['orders', 'organizations', 'threads', 'documents', 'finance', 'leads']) {
    fd.set(k, over[k] ?? 'assigned');
  }
  fd.append('capabilities', 'see_commission');
  fd.append('capabilities', 'export');
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
  revalidatePath.mockReturnValue(undefined);
});

describe('createAccessProfileAction', () => {
  it('builds input from FormData, calls service, returns id, revalidates both cabinets', async () => {
    createAccessProfile.mockResolvedValue({ ok: true, id: 'p-1' });
    const res = await createAccessProfileAction(profileForm({ orders: 'own' }));
    expect(res).toEqual({ ok: true, id: 'p-1' });
    expect(createAccessProfile).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({
        name: 'Оператор',
        orders: 'own',
        capabilities: ['see_commission', 'export'],
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/leader/settings/access/roles');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/access/roles');
  });

  it('maps a service error and does not revalidate', async () => {
    createAccessProfile.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await createAccessProfileAction(profileForm());
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('updateAccessProfileAction', () => {
  it('missing id → validation, service not called', async () => {
    const res = await updateAccessProfileAction(profileForm());
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(updateAccessProfile).not.toHaveBeenCalled();
  });

  it('with id → calls service and revalidates', async () => {
    updateAccessProfile.mockResolvedValue({ ok: true });
    const fd = profileForm();
    fd.set('id', 'p-9');
    const res = await updateAccessProfileAction(fd);
    expect(res).toEqual({ ok: true });
    expect(updateAccessProfile).toHaveBeenCalledWith(
      {},
      SESSION,
      'p-9',
      expect.objectContaining({ name: 'Оператор' })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/access/roles');
  });

  it('maps name_taken', async () => {
    updateAccessProfile.mockResolvedValue({ ok: false, error: 'name_taken' });
    const fd = profileForm();
    fd.set('id', 'p-9');
    expect(await updateAccessProfileAction(fd)).toEqual({ ok: false, error: 'name_taken' });
  });
});

describe('deleteAccessProfileAction', () => {
  it('missing id → validation', async () => {
    expect(await deleteAccessProfileAction(new FormData())).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(deleteAccessProfile).not.toHaveBeenCalled();
  });

  it('with id → calls service', async () => {
    deleteAccessProfile.mockResolvedValue({ ok: true });
    const fd = new FormData();
    fd.set('id', 'p-3');
    expect(await deleteAccessProfileAction(fd)).toEqual({ ok: true });
    expect(deleteAccessProfile).toHaveBeenCalledWith({}, SESSION, 'p-3');
  });
});

describe('assignUserProfileAction', () => {
  it('missing userId → validation', async () => {
    expect(await assignUserProfileAction(new FormData())).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(assignUserProfile).not.toHaveBeenCalled();
  });

  it('empty profileId → null (unassign)', async () => {
    assignUserProfile.mockResolvedValue({ ok: true });
    const fd = new FormData();
    fd.set('userId', 'u-7');
    fd.set('profileId', '');
    expect(await assignUserProfileAction(fd)).toEqual({ ok: true });
    expect(assignUserProfile).toHaveBeenCalledWith({}, SESSION, { userId: 'u-7', profileId: null });
  });

  it('set profileId → passed through; maps not_found', async () => {
    assignUserProfile.mockResolvedValue({ ok: false, error: 'not_found' });
    const fd = new FormData();
    fd.set('userId', 'u-7');
    fd.set('profileId', 'p-2');
    expect(await assignUserProfileAction(fd)).toEqual({ ok: false, error: 'not_found' });
    expect(assignUserProfile).toHaveBeenCalledWith({}, SESSION, {
      userId: 'u-7',
      profileId: 'p-2',
    });
  });
});
