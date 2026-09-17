import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireOrganization, requirePartner, revalidatePath, dismissOrg, dismissPartner } =
  vi.hoisted(() => ({
    requireOrganization: vi.fn(),
    requirePartner: vi.fn(),
    revalidatePath: vi.fn(),
    dismissOrg: vi.fn(),
    dismissPartner: vi.fn(),
  }));
vi.mock('@/lib/auth/requireRole', () => ({ requireOrganization, requirePartner }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/services/organization/firstSteps', () => ({ dismissOrgFirstSteps: dismissOrg }));
vi.mock('@/lib/services/partner/firstSteps', () => ({ dismissPartnerFirstSteps: dismissPartner }));

import { dismissOrgFirstStepsAction } from '@/server-actions/organization/firstSteps';
import { dismissPartnerFirstStepsAction } from '@/server-actions/partner/firstSteps';

/** «Закрыть» «Первые шаги» (`У-239`): гард роли + скоуп членства. */

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  dismissOrg.mockResolvedValue({ ok: true });
  dismissPartner.mockResolvedValue({ ok: true });
});

describe('dismissOrgFirstStepsAction', () => {
  it('своя организация: сервис по членству + перечитать главную', async () => {
    requireOrganization.mockResolvedValue({
      sub: 'u1',
      role: 'organization',
      organizationMemberships: [
        { organizationId: 'org1', isActive: true },
        { organizationId: 'org2', isActive: true },
      ],
    });
    await dismissOrgFirstStepsAction(fd({ organizationId: 'org2' }));
    expect(dismissOrg).toHaveBeenCalledWith({}, { organizationId: 'org2', userId: 'u1' });
    expect(revalidatePath).toHaveBeenCalledWith('/organization/dashboard');
  });

  it('чужая организация или пустое поле — сервис не зовётся', async () => {
    requireOrganization.mockResolvedValue({
      sub: 'u1',
      role: 'organization',
      organizationMemberships: [{ organizationId: 'org1', isActive: true }],
    });
    await dismissOrgFirstStepsAction(fd({ organizationId: 'alien' }));
    await dismissOrgFirstStepsAction(fd({}));
    expect(dismissOrg).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('без сессии заказчика — гард бросает, дальше не идём', async () => {
    requireOrganization.mockRejectedValue(new Error('REDIRECT'));
    await expect(dismissOrgFirstStepsAction(fd({ organizationId: 'org1' }))).rejects.toThrow(
      'REDIRECT'
    );
    expect(dismissOrg).not.toHaveBeenCalled();
  });
});

describe('dismissPartnerFirstStepsAction', () => {
  it('партнёр из сессии, не из формы', async () => {
    requirePartner.mockResolvedValue({ sub: 'u9', role: 'partner', partnerId: 'p1' });
    await dismissPartnerFirstStepsAction();
    expect(dismissPartner).toHaveBeenCalledWith({}, { partnerId: 'p1', userId: 'u9' });
    expect(revalidatePath).toHaveBeenCalledWith('/partner/dashboard');
  });
});
