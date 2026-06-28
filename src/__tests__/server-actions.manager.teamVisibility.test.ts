import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireManagerLeader,
  revalidatePath,
  setTeamVisibility
} = vi.hoisted(() => ({
  requireManagerLeader: vi.fn(),
  revalidatePath: vi.fn(),
  setTeamVisibility: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/manager/teamVisibility', () => ({ setTeamVisibility }));

import { setTeamVisibilityAction } from '@/server-actions/manager/teamVisibility';

const LEADER_SESSION = {
  sub: 'leader-1',
  role: 'manager' as const,
  managerRole: 'leader' as const,
  companyId: 'co-A',
  managedOrgIds: ['org-1']
};

beforeEach(() => {
  vi.clearAllMocks();
  requireManagerLeader.mockResolvedValue(LEADER_SESSION);
  revalidatePath.mockReturnValue(undefined);
});

describe('setTeamVisibilityAction — no_company guard', () => {
  it('returns no_company when session has no companyId', async () => {
    requireManagerLeader.mockResolvedValue({ ...LEADER_SESSION, companyId: undefined });

    const res = await setTeamVisibilityAction({ enabled: true });

    expect(res).toEqual({ ok: false, error: 'no_company' });
    expect(setTeamVisibility).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns no_company when companyId is null', async () => {
    requireManagerLeader.mockResolvedValue({ ...LEADER_SESSION, companyId: null });

    const res = await setTeamVisibilityAction({ enabled: false });

    expect(res).toEqual({ ok: false, error: 'no_company' });
    expect(setTeamVisibility).not.toHaveBeenCalled();
  });
});

describe('setTeamVisibilityAction — validation', () => {
  it('returns validation on non-boolean input', async () => {
    // @ts-expect-error — intentional bad input for runtime guard test
    const res = await setTeamVisibilityAction({ enabled: 'yes' });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(setTeamVisibility).not.toHaveBeenCalled();
  });
});

describe('setTeamVisibilityAction — happy path', () => {
  it('calls setTeamVisibility and revalidates when leader has companyId', async () => {
    setTeamVisibility.mockResolvedValue({ ok: true, changed: true });

    const res = await setTeamVisibilityAction({ enabled: true });

    expect(res).toEqual({ ok: true, changed: true });
    expect(setTeamVisibility).toHaveBeenCalledWith(
      expect.anything(),
      'leader-1',
      'co-A',
      true
    );
    expect(revalidatePath).toHaveBeenCalledWith('/manager/team');
    expect(revalidatePath).toHaveBeenCalledWith('/manager/dashboard');
  });

  it('returns changed:false when visibility was already set to the same value', async () => {
    setTeamVisibility.mockResolvedValue({ ok: true, changed: false });

    const res = await setTeamVisibilityAction({ enabled: false });

    expect(res).toEqual({ ok: true, changed: false });
    expect(setTeamVisibility).toHaveBeenCalledWith(
      expect.anything(),
      'leader-1',
      'co-A',
      false
    );
    // revalidatePath still fires (idempotent, harmless)
    expect(revalidatePath).toHaveBeenCalledWith('/manager/team');
    expect(revalidatePath).toHaveBeenCalledWith('/manager/dashboard');
  });
});

describe('setTeamVisibilityAction — company_not_found', () => {
  it('returns company_not_found and does not revalidate when company row is missing', async () => {
    setTeamVisibility.mockResolvedValue({ ok: false, error: 'company_not_found' });

    const res = await setTeamVisibilityAction({ enabled: true });

    expect(res).toEqual({ ok: false, error: 'company_not_found' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
