/**
 * Тонкий адаптер настроек профиля сотрудника: гард роли и прокидка в сервис.
 * Нормализация значения и запись — в services.staff.profile.test.ts.
 */
import { it, expect, vi, beforeEach } from 'vitest';

const { requireManager, updateInternalPhone } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  updateInternalPhone: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/services/staff/profile', () => ({ updateInternalPhone }));

import { prisma } from '@/lib/db/prisma';
import { updateInternalPhoneAction } from '@/server-actions/staff-profile';

const session = { sub: 'u1', role: 'manager', companyId: 'c1' };
beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue(session);
});

it('требует менеджера и делегирует значение в сервис как есть', async () => {
  updateInternalPhone.mockResolvedValue({ ok: true });
  const res = await updateInternalPhoneAction({ internalPhone: '  101  ' });
  expect(requireManager).toHaveBeenCalledOnce();
  expect(updateInternalPhone).toHaveBeenCalledWith(prisma, session, { internalPhone: '  101  ' });
  expect(res).toEqual({ ok: true });
});

it('прокидывает invalid из сервиса', async () => {
  updateInternalPhone.mockResolvedValue({ ok: false, error: 'invalid' });
  const res = await updateInternalPhoneAction({ internalPhone: 'x'.repeat(33) });
  expect(res).toEqual({ ok: false, error: 'invalid' });
});
