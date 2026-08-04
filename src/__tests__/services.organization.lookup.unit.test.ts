/**
 * Unit-тесты для src/lib/services/organization/lookup.ts.
 *
 * Читалка названия организации для писем-приглашений: вынесена из четырёх
 * server-actions (admin/partner/organization). Здесь проверяется форма запроса
 * (узкий select по id) и обе ветки результата.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrganizationName } from '@/lib/services/organization/lookup';

const findUnique = vi.fn();
const prisma = { organization: { findUnique } } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getOrganizationName', () => {
  it('читает узким select по id и возвращает название', async () => {
    findUnique.mockResolvedValue({ name: 'ООО Тест' });

    expect(await getOrganizationName(prisma, 'org-1')).toBe('ООО Тест');
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      select: { name: true },
    });
  });

  it('возвращает null, когда организации нет (запасное название подставляет вызывающий)', async () => {
    findUnique.mockResolvedValue(null);

    expect(await getOrganizationName(prisma, 'org-missing')).toBeNull();
  });
});
