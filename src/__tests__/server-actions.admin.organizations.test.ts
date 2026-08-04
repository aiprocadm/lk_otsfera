import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdmin,
  updateOrganization,
  createOrganization,
  applyOrgRateOverride,
  revalidatePath,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  updateOrganization: vi.fn(),
  createOrganization: vi.fn(),
  applyOrgRateOverride: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('next/cache', () => ({ revalidatePath }));

vi.mock('@/lib/services/admin/organizations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/admin/organizations')>(
    '@/lib/services/admin/organizations'
  );
  return { ...actual, updateOrganization, createOrganization };
});

vi.mock('@/lib/services/admin/orgRateOverride', () => ({ applyOrgRateOverride }));

import {
  createOrganizationAction,
  updateOrganizationAction,
  setOrgRateOverrideAction,
  updateOrgFormAction,
  setOrgRateOverrideFormAction,
} from '@/server-actions/admin/organizations';

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ sub: 'admin-1', name: 'Admin User' });
});

describe('createOrganizationAction', () => {
  it('returns validation when name is empty (no service call)', async () => {
    const res = await createOrganizationAction(fd({ name: '' }));
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it('happy path returns the new id and revalidates the list', async () => {
    createOrganization.mockResolvedValue({ ok: true, id: 'org-new' });

    const res = await createOrganizationAction(
      fd({ name: 'ООО Ромашка', inn: '7712345678', kpp: '771201001' })
    );

    expect(res).toEqual({ ok: true, id: 'org-new' });
    expect(createOrganization).toHaveBeenCalledWith(expect.anything(), 'admin-1', {
      name: 'ООО Ромашка',
      inn: '7712345678',
      kpp: '771201001',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/organizations');
  });

  it('propagates inn_exists from the service', async () => {
    createOrganization.mockResolvedValue({ ok: false, error: 'inn_exists' });
    const res = await createOrganizationAction(fd({ name: 'Дубль', inn: '7700000000' }));
    expect(res).toEqual({ ok: false, error: 'inn_exists' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('omits blank inn/kpp (passed as undefined to zod)', async () => {
    createOrganization.mockResolvedValue({ ok: true, id: 'o1' });
    await createOrganizationAction(fd({ name: 'Без реквизитов' }));
    expect(createOrganization).toHaveBeenCalledWith(expect.anything(), 'admin-1', {
      name: 'Без реквизитов',
    });
  });
});

describe('updateOrganizationAction', () => {
  it('returns validation error when id is empty — bare stable code, no zod details (R2)', async () => {
    const res = await updateOrganizationAction(fd({ id: '', name: 'New Name' }));
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it('happy path calls updateOrganization and revalidates both paths', async () => {
    updateOrganization.mockResolvedValue({ ok: true });

    const res = await updateOrganizationAction(
      fd({ id: 'org-1', name: 'Updated Name', inn: '1234567890', kpp: '123456789' })
    );

    expect(res).toEqual({ ok: true });
    expect(updateOrganization).toHaveBeenCalledWith(expect.anything(), 'admin-1', 'org-1', {
      name: 'Updated Name',
      inn: '1234567890',
      kpp: '123456789',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/organizations');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/organizations/org-1');
  });

  it('maps not_found Result to Failure', async () => {
    updateOrganization.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await updateOrganizationAction(fd({ id: 'gone-1', name: 'X' }));
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('omits name/inn/kpp when form fields are empty (|| undefined fallback)', async () => {
    // When name/inn/kpp fields are empty strings: readField returns '' → '' || undefined → undefined
    // This covers the || fallback branches for optional fields
    updateOrganization.mockResolvedValue({ ok: true });
    const formWithId = new FormData();
    formWithId.append('id', 'org-1');
    // No 'name', 'inn', 'kpp' keys — readField returns '' → || undefined
    const res = await updateOrganizationAction(formWithId);
    expect(res).toEqual({ ok: true });
    expect(updateOrganization).toHaveBeenCalledWith(
      expect.anything(),
      'admin-1',
      'org-1',
      {} // no name/inn/kpp
    );
  });
});

describe('setOrgRateOverrideAction', () => {
  it('returns validation error when reason is missing — bare stable code, no zod details (R2)', async () => {
    const res = await setOrgRateOverrideAction(fd({ organizationId: 'org-1', ratePercent: '8' }));
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(applyOrgRateOverride).not.toHaveBeenCalled();
  });

  it('set happy path: передаёт ratePercent и changedByUserId в сервис + ревалидирует карточку', async () => {
    applyOrgRateOverride.mockResolvedValue({ ok: true });

    const res = await setOrgRateOverrideAction(
      fd({ organizationId: 'org-1', ratePercent: '8', reason: 'vip client' })
    );

    expect(res).toEqual({ ok: true });
    expect(applyOrgRateOverride).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      ratePercent: 8,
      reason: 'vip client',
      changedByUserId: 'admin-1',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/organizations/org-1');
  });

  it('clear happy path: передаёт clear=true (без ratePercent) и ревалидирует', async () => {
    applyOrgRateOverride.mockResolvedValue({ ok: true });

    const res = await setOrgRateOverrideAction(
      fd({ organizationId: 'org-1', reason: 'reverting override', clear: 'true' })
    );

    expect(res).toEqual({ ok: true });
    expect(applyOrgRateOverride).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      reason: 'reverting override',
      changedByUserId: 'admin-1',
      clear: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/organizations/org-1');
  });

  it('maps service rate_out_of_range Result to rate_out_of_range failure', async () => {
    applyOrgRateOverride.mockResolvedValue({ ok: false, error: 'rate_out_of_range' });

    const res = await setOrgRateOverrideAction(
      fd({ organizationId: 'org-1', ratePercent: '8', reason: 'bad rate' })
    );

    expect(res).toEqual({ ok: false, error: 'rate_out_of_range' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('maps service validation Result (ни clear, ни ratePercent) to validation', async () => {
    applyOrgRateOverride.mockResolvedValue({ ok: false, error: 'validation' });

    const res = await setOrgRateOverrideAction(fd({ organizationId: 'org-1', reason: 'test' }));

    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(applyOrgRateOverride).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      reason: 'test',
      changedByUserId: 'admin-1',
    });
  });

  it('maps service not_found Result to not_found', async () => {
    applyOrgRateOverride.mockResolvedValue({ ok: false, error: 'not_found' });

    const res = await setOrgRateOverrideAction(
      fd({ organizationId: 'org-1', ratePercent: '8', reason: 'test' })
    );

    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('form-action wrappers (discard result, log on failure)', () => {
  it('updateOrgFormAction returns void on success', async () => {
    updateOrganization.mockResolvedValue({ ok: true });
    const result = await updateOrgFormAction(fd({ id: 'org-1', name: 'New' }));
    expect(result).toBeUndefined();
    expect(updateOrganization).toHaveBeenCalled();
  });

  it('updateOrgFormAction logs and swallows failure', async () => {
    updateOrganization.mockResolvedValue({ ok: false, error: 'not_found' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await updateOrgFormAction(fd({ id: 'gone', name: 'X' }));
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('setOrgRateOverrideFormAction returns void on success', async () => {
    applyOrgRateOverride.mockResolvedValue({ ok: true });
    const result = await setOrgRateOverrideFormAction(
      fd({ organizationId: 'org-1', ratePercent: '5', reason: 'test' })
    );
    expect(result).toBeUndefined();
    expect(applyOrgRateOverride).toHaveBeenCalled();
  });

  it('setOrgRateOverrideFormAction logs and swallows failure', async () => {
    applyOrgRateOverride.mockResolvedValue({ ok: false, error: 'not_found' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await setOrgRateOverrideFormAction(
      fd({ organizationId: 'missing', ratePercent: '5', reason: 'test' })
    );
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
