import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdmin,
  updateOrganization,
  setOrgCommissionRate,
  clearOrgCommissionRate,
  revalidatePath,
  organizationFindUnique
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  updateOrganization: vi.fn(),
  setOrgCommissionRate: vi.fn(),
  clearOrgCommissionRate: vi.fn(),
  revalidatePath: vi.fn(),
  organizationFindUnique: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { organization: { findUnique: organizationFindUnique } }
}));
vi.mock('next/cache', () => ({ revalidatePath }));

vi.mock('@/lib/services/admin/organizations', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/services/admin/organizations')>(
      '@/lib/services/admin/organizations'
    );
  return { ...actual, updateOrganization };
});

vi.mock('@/lib/services/partner/rateOverride', () => ({
  setOrgCommissionRate,
  clearOrgCommissionRate
}));

import {
  updateOrganizationAction,
  setOrgRateOverrideAction,
  updateOrgFormAction,
  setOrgRateOverrideFormAction
} from '@/server-actions/admin/organizations';
import { AdminOrgError } from '@/lib/services/admin/organizations';

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ sub: 'admin-1', name: 'Admin User' });
});

describe('updateOrganizationAction', () => {
  it('returns validation error when id is empty', async () => {
    const res = await updateOrganizationAction(fd({ id: '', name: 'New Name' }));
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it('happy path calls updateOrganization and revalidates both paths', async () => {
    updateOrganization.mockResolvedValue(undefined);

    const res = await updateOrganizationAction(
      fd({ id: 'org-1', name: 'Updated Name', inn: '1234567890', kpp: '123456789' })
    );

    expect(res).toEqual({ ok: true });
    expect(updateOrganization).toHaveBeenCalledWith(
      expect.anything(),
      'admin-1',
      'org-1',
      { name: 'Updated Name', inn: '1234567890', kpp: '123456789' }
    );
    expect(revalidatePath).toHaveBeenCalledWith('/admin/organizations');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/organizations/org-1');
  });

  it('maps AdminOrgError(not_found) to Failure', async () => {
    updateOrganization.mockRejectedValue(new AdminOrgError('not_found'));
    const res = await updateOrganizationAction(fd({ id: 'gone-1', name: 'X' }));
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('omits name/inn/kpp when form fields are empty (|| undefined fallback)', async () => {
    // When name/inn/kpp fields are empty strings: readField returns '' → '' || undefined → undefined
    // This covers the || fallback branches for optional fields
    updateOrganization.mockResolvedValue(undefined);
    const formWithId = new FormData();
    formWithId.append('id', 'org-1');
    // No 'name', 'inn', 'kpp' keys — readField returns '' → || undefined
    const res = await updateOrganizationAction(formWithId);
    expect(res).toEqual({ ok: true });
    expect(updateOrganization).toHaveBeenCalledWith(
      expect.anything(),
      'admin-1',
      'org-1',
      {}  // no name/inn/kpp
    );
  });
});

describe('setOrgRateOverrideAction', () => {
  it('returns validation error when reason is missing', async () => {
    const res = await setOrgRateOverrideAction(
      fd({ organizationId: 'org-1', ratePercent: '8' })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(organizationFindUnique).not.toHaveBeenCalled();
    expect(setOrgCommissionRate).not.toHaveBeenCalled();
  });

  it('returns not_found when org lookup returns null', async () => {
    organizationFindUnique.mockResolvedValue(null);

    const res = await setOrgRateOverrideAction(
      fd({ organizationId: 'missing-org', ratePercent: '8', reason: 'special deal' })
    );

    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(setOrgCommissionRate).not.toHaveBeenCalled();
  });

  it('set happy path: calls setOrgCommissionRate with newRate as fraction and partnerId from lookup', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'partner-42' });
    setOrgCommissionRate.mockResolvedValue(undefined);

    const res = await setOrgRateOverrideAction(
      fd({ organizationId: 'org-1', ratePercent: '8', reason: 'vip client' })
    );

    expect(res).toEqual({ ok: true });
    expect(setOrgCommissionRate).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'org-1',
        partnerId: 'partner-42',
        newRate: 0.08,
        reason: 'vip client',
        changedByUserId: 'admin-1'
      }
    );
    expect(revalidatePath).toHaveBeenCalledWith('/admin/organizations/org-1');
  });

  it('clear happy path: calls clearOrgCommissionRate when clear=true', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'partner-42' });
    clearOrgCommissionRate.mockResolvedValue(undefined);

    const res = await setOrgRateOverrideAction(
      fd({ organizationId: 'org-1', reason: 'reverting override', clear: 'true' })
    );

    expect(res).toEqual({ ok: true });
    expect(clearOrgCommissionRate).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'org-1',
        partnerId: 'partner-42',
        reason: 'reverting override',
        changedByUserId: 'admin-1'
      }
    );
    expect(setOrgCommissionRate).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/admin/organizations/org-1');
  });

  it('maps RATE_OUT_OF_RANGE error to rate_out_of_range failure', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'partner-42' });
    setOrgCommissionRate.mockRejectedValue(new Error('RATE_OUT_OF_RANGE: rate must be in (0, 1)'));

    const res = await setOrgRateOverrideAction(
      fd({ organizationId: 'org-1', ratePercent: '8', reason: 'bad rate' })
    );

    expect(res).toEqual({ ok: false, error: 'rate_out_of_range' });
  });

  it('returns validation error when both clear and ratePercent are absent', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'partner-42' });

    const res = await setOrgRateOverrideAction(
      fd({ organizationId: 'org-1', reason: 'test' })
    );

    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(setOrgCommissionRate).not.toHaveBeenCalled();
    expect(clearOrgCommissionRate).not.toHaveBeenCalled();
  });

  it('returns not_found when org has no partnerId (standalone org)', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: null });

    const res = await setOrgRateOverrideAction(
      fd({ organizationId: 'standalone-org', ratePercent: '8', reason: 'n/a' })
    );

    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(setOrgCommissionRate).not.toHaveBeenCalled();
  });

  it('maps NOT_FOUND error message to not_found', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'p-42' });
    setOrgCommissionRate.mockRejectedValue(new Error('NOT_FOUND: org missing'));

    const res = await setOrgRateOverrideAction(
      fd({ organizationId: 'org-1', ratePercent: '8', reason: 'test' })
    );

    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('re-throws unrecognised errors that are not AdminOrgError or NOT_FOUND/RATE_OUT_OF_RANGE messages', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'p-42' });
    setOrgCommissionRate.mockRejectedValue(new Error('DB connection reset'));

    await expect(
      setOrgRateOverrideAction(fd({ organizationId: 'org-1', ratePercent: '8', reason: 'test' }))
    ).rejects.toThrow('DB connection reset');
  });
});

describe('form-action wrappers (discard result, log on failure)', () => {
  it('updateOrgFormAction returns void on success', async () => {
    updateOrganization.mockResolvedValue(undefined);
    const result = await updateOrgFormAction(fd({ id: 'org-1', name: 'New' }));
    expect(result).toBeUndefined();
    expect(updateOrganization).toHaveBeenCalled();
  });

  it('updateOrgFormAction logs and swallows failure', async () => {
    updateOrganization.mockRejectedValue(new AdminOrgError('not_found'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await updateOrgFormAction(fd({ id: 'gone', name: 'X' }));
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('setOrgRateOverrideFormAction returns void on success', async () => {
    organizationFindUnique.mockResolvedValue({ partnerId: 'p-1' });
    setOrgCommissionRate.mockResolvedValue(undefined);
    const result = await setOrgRateOverrideFormAction(
      fd({ organizationId: 'org-1', ratePercent: '5', reason: 'test' })
    );
    expect(result).toBeUndefined();
    expect(setOrgCommissionRate).toHaveBeenCalled();
  });

  it('setOrgRateOverrideFormAction logs and swallows failure', async () => {
    organizationFindUnique.mockResolvedValue(null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await setOrgRateOverrideFormAction(
      fd({ organizationId: 'missing', ratePercent: '5', reason: 'test' })
    );
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
