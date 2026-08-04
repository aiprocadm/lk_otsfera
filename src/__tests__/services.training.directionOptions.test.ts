import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Аудит A1: справочник направлений для селектов/фильтров уехал со страниц в
 * сервис. Здесь пиннится форма запроса — раньше это проверялось в тестах
 * страниц (pages.*-enrollments, pages.certificates-registry).
 */

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { trainingDirection: { findMany } } }));

import { prisma } from '@/lib/db/prisma';
import {
  listDirectionOptions,
  listDirectionFilterOptions,
} from '@/lib/services/training/directions';

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([{ id: 'd1', name: 'Охрана труда' }]);
});

describe('listDirectionOptions (селект мастера заявок)', () => {
  it('только активные, порядок sortOrder → name, узкий select', async () => {
    const rows = await listDirectionOptions(prisma);

    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    });
    expect(rows).toEqual([{ id: 'd1', name: 'Охрана труда' }]);
  });
});

describe('listDirectionFilterOptions (фильтр реестра удостоверений)', () => {
  it('только активные, порядок только по sortOrder, узкий select', async () => {
    const rows = await listDirectionFilterOptions(prisma);

    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    });
    expect(rows).toEqual([{ id: 'd1', name: 'Охрана труда' }]);
  });
});
