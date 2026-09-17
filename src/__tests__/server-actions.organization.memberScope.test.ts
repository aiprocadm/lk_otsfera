import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireOrganization, revalidatePath, setOrgMemberScope } = vi.hoisted(() => ({
  requireOrganization: vi.fn(),
  revalidatePath: vi.fn(),
  setOrgMemberScope: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireOrganization }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/services/organization/memberScope', () => ({ setOrgMemberScope }));

import { setOrgMemberScopeAction } from '@/server-actions/organization/memberScope';

/** `У-236`: переключатель правила организации. */
function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
}

const SESSION = { sub: 'u1', role: 'organization' };

beforeEach(() => {
  vi.clearAllMocks();
  requireOrganization.mockResolvedValue(SESSION);
  setOrgMemberScope.mockResolvedValue({ ok: true });
});

describe('setOrgMemberScopeAction', () => {
  it('галочка включена → true, снята → false; перечитываются заказы и главная', async () => {
    expect(await setOrgMemberScopeAction(fd({ organizationId: 'o1', value: 'on' }))).toEqual({
      ok: true,
    });
    expect(setOrgMemberScope).toHaveBeenCalledWith({}, SESSION, 'o1', true);
    await setOrgMemberScopeAction(fd({ organizationId: 'o1' }));
    expect(setOrgMemberScope).toHaveBeenLastCalledWith({}, SESSION, 'o1', false);
    expect(revalidatePath).toHaveBeenCalledWith('/organization/orders');
    expect(revalidatePath).toHaveBeenCalledWith('/organization/dashboard');
  });

  it('без организации — validation; отказ сервиса возвращается как есть', async () => {
    expect(await setOrgMemberScopeAction(fd({ value: 'on' }))).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(setOrgMemberScope).not.toHaveBeenCalled();
    setOrgMemberScope.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await setOrgMemberScopeAction(fd({ organizationId: 'o1', value: 'on' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('гард роли бросает — сервис не зовётся', async () => {
    requireOrganization.mockRejectedValue(new Error('REDIRECT'));
    await expect(setOrgMemberScopeAction(fd({ organizationId: 'o1' }))).rejects.toThrow('REDIRECT');
    expect(setOrgMemberScope).not.toHaveBeenCalled();
  });
});
