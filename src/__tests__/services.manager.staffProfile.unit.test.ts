/**
 * Unit-тесты src/lib/services/manager/staffProfile.ts — чтение профиля
 * сотрудника (аудит A1: запрос уехал со страницы /manager/settings в сервис).
 * Здесь пиннится форма запроса: строго свой пользователь + узкий select.
 */
import { describe, it, expect, vi } from 'vitest';
import { getStaffInternalPhone } from '@/lib/services/manager/staffProfile';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'u1',
  role: 'manager',
  // Руководитель — отдельная роль 'leader' (ТЗ 2026-08-17), суб-роли больше нет.
  companyId: 'co-1',
};

describe('getStaffInternalPhone', () => {
  it('читает только своего пользователя и только поле internalPhone', async () => {
    const findUnique = vi.fn().mockResolvedValue({ internalPhone: '101' });
    const prisma = { user: { findUnique } } as never;

    const phone = await getStaffInternalPhone(prisma, SESSION);

    expect(phone).toBe('101');
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { internalPhone: true },
    });
  });

  it('номер не задан → null', async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ internalPhone: null }) },
    } as never;

    expect(await getStaffInternalPhone(prisma, SESSION)).toBeNull();
  });

  it('пользователя нет (удалён между запросами) → null, без падения', async () => {
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue(null) } } as never;

    expect(await getStaffInternalPhone(prisma, SESSION)).toBeNull();
  });
});
