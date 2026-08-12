import { describe, it, expect, vi } from 'vitest';
import { getAutoCreatedFrom1C } from '@/lib/services/organization/autoCreated';

/**
 * `У-54`: карточка организации спрашивает журнал аудита, завёл ли её импорт.
 * Отдельного поля у организации нет — источником ТЗ называет именно аудит,
 * поэтому проверяем разбор его полезной нагрузки, включая кривые случаи.
 */
function db(row: unknown) {
  const findFirst = vi.fn().mockResolvedValue(row);
  return { prisma: { auditLog: { findFirst } } as never, findFirst };
}

describe('getAutoCreatedFrom1C (У-54)', () => {
  it('находит запись автосоздания и отдаёт дату с именем файла', async () => {
    const { prisma, findFirst } = db({
      createdAt: new Date('2026-08-12T09:00:00.000Z'),
      meta: { after: { source: 'payment_import_auto', fileName: 'Карточка 51.xls' } },
    });
    expect(await getAutoCreatedFrom1C(prisma, 'org-1')).toEqual({
      at: '2026-08-12T09:00:00.000Z',
      fileName: 'Карточка 51.xls',
    });
    // Ищем строго действие автосоздания — ручное создание плашки не даёт.
    expect(findFirst.mock.calls[0]![0].where).toMatchObject({
      entity: 'organization',
      entityId: 'org-1',
      action: 'organization_created_auto',
    });
  });

  it('обычная организация — записи нет, плашки не будет', async () => {
    const { prisma } = db(null);
    expect(await getAutoCreatedFrom1C(prisma, 'org-2')).toBeNull();
  });

  it('запись без полезной нагрузки не роняет карточку', async () => {
    // Аудит мог быть записан старой версией или урезан — карточка обязана
    // пережить это и показать плашку без имени файла.
    const { prisma } = db({ createdAt: new Date('2026-08-12T09:00:00.000Z'), meta: null });
    expect(await getAutoCreatedFrom1C(prisma, 'org-3')).toEqual({
      at: '2026-08-12T09:00:00.000Z',
      fileName: null,
    });
  });

  it('нестроковое имя файла отбрасывается', async () => {
    const { prisma } = db({
      createdAt: new Date('2026-08-12T09:00:00.000Z'),
      meta: { after: { fileName: 42 } },
    });
    expect((await getAutoCreatedFrom1C(prisma, 'org-4'))?.fileName).toBeNull();
  });
});
