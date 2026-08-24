// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
}));
vi.mock('next/navigation', () => ({ redirect }));

import ManagerStudentsLegacyPage from '@/app/manager/students/page';

beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue({ sub: 'm1', role: 'manager', companyId: 'co-1' });
});

/**
 * `У-103`: сквозной список сотрудников у менеджера снят — люди ведутся в
 * карточке организации (`У-97`). Старый адрес не удалён, а стал шлюзом:
 * закладки и ссылки из писем продолжают работать.
 */
describe('/manager/students — шлюз (У-103)', () => {
  it('уводит на список организаций', async () => {
    await expect(ManagerStudentsLegacyPage()).rejects.toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/manager/organizations');
  });

  it('гард роли остаётся: шлюз не открывает данные посторонним', async () => {
    await expect(ManagerStudentsLegacyPage()).rejects.toThrow('REDIRECT');
    expect(requireManager).toHaveBeenCalled();
  });
});
