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
  listAllDirectionOptions,
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

describe('listAllDirectionOptions (сопоставление импорта каталога)', () => {
  it('берёт ВСЕ направления, включая выключенные', async () => {
    const rows = await listAllDirectionOptions(prisma);

    // Отбора по `isActive` здесь нет намеренно (`У-137`): позиция каталога
    // может ссылаться на направление, выключенное уже ПОСЛЕ выгрузки. Отсеки
    // мы такие — обратная загрузка того же файла перестала бы находить
    // направление по имени и завела бы дубль.
    expect(findMany).toHaveBeenCalledWith({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    });
    expect(findMany.mock.calls[0]?.[0]).not.toHaveProperty('where');
    expect(rows).toEqual([{ id: 'd1', name: 'Охрана труда' }]);
  });
});
