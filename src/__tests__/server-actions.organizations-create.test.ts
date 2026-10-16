import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Серверное действие «Создать организацию» (`У-308`, `У-309`): форма входа —
 * здесь, всё остальное — в сервисе; после создания обновляются списки.
 */
const { requireSession, createOrganizationByManager, revalidatePath } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createOrganizationByManager: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/manager/organizationCreate', () => ({ createOrganizationByManager }));
vi.mock('next/cache', () => ({ revalidatePath }));

import { createOrganizationAction } from '@/server-actions/organizations/create';

const SESSION = { sub: 'u1', role: 'manager' };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
});

describe('createOrganizationAction', () => {
  it('кривая форма — validation, сервис не зовётся', async () => {
    expect(await createOrganizationAction({ name: 'x'.repeat(301) })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(createOrganizationByManager).not.toHaveBeenCalled();
  });

  it('успех — ответ сервиса и обновлённые списки', async () => {
    createOrganizationByManager.mockResolvedValue({ ok: true, organizationId: 'o1', name: 'Р' });
    expect(await createOrganizationAction({ name: 'Р', inn: '7701234567' })).toEqual({
      ok: true,
      organizationId: 'o1',
      name: 'Р',
    });
    expect(createOrganizationByManager).toHaveBeenCalledWith({}, SESSION, {
      name: 'Р',
      inn: '7701234567',
    });
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual([
      '/manager/organizations',
      '/manager/contacts',
      '/admin/contacts',
    ]);
  });

  it('отказ сервиса — как есть, списки не трогаем', async () => {
    createOrganizationByManager.mockResolvedValue({
      ok: false,
      error: 'org_exists',
      organizationId: 'o9',
    });
    expect(await createOrganizationAction({ name: 'Р' })).toEqual({
      ok: false,
      error: 'org_exists',
      organizationId: 'o9',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
