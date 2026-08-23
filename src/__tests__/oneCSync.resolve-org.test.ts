import { describe, it, expect, vi } from 'vitest';
import { resolveOrganizationRef } from '@/lib/services/oneCSync/resolve-org';

function dbWith(orgs: any[]) {
  return {
    organization: {
      findFirst: vi.fn(
        async ({ where }: any) =>
          orgs.find(
            (o) =>
              (where.externalId && o.externalId === where.externalId) ||
              (where.inn && o.inn === where.inn)
          ) ?? null
      ),
      update: vi.fn(async () => ({})),
    },
  } as any;
}
describe('resolveOrganizationRef', () => {
  it('matches by externalId first', async () => {
    const db = dbWith([{ id: 'a', externalId: 'E1', inn: '77' }]);
    expect(await resolveOrganizationRef(db, { externalId: 'E1' }, true)).toMatchObject({ id: 'a' });
  });
  it('falls back to inn and backfills externalId', async () => {
    const db = dbWith([{ id: 'b', externalId: null, inn: '77' }]);
    const r = await resolveOrganizationRef(db, { externalId: 'E2', inn: '77' }, true);
    expect(r).toMatchObject({ id: 'b', externalId: 'E2' });
    expect(db.organization.update).toHaveBeenCalledWith({
      where: { id: 'b' },
      data: { externalId: 'E2' },
    });
  });
  it('returns null when nothing matches', async () => {
    expect(await resolveOrganizationRef(dbWith([]), { inn: '00' }, true)).toBeNull();
  });

  it('falls back to inn but does NOT update externalId if org already has one', async () => {
    // org already has externalId='E-EXISTING', ref.externalId='E2' — should NOT update
    const db = dbWith([{ id: 'c', externalId: 'E-EXISTING', inn: '88' }]);
    const r = await resolveOrganizationRef(db, { externalId: 'E2', inn: '88' }, true);
    expect(r).toMatchObject({ id: 'c', externalId: 'E-EXISTING' });
    expect(db.organization.update).not.toHaveBeenCalled();
  });

  it('returns null when only inn is provided and nothing matches', async () => {
    const db = dbWith([]);
    expect(await resolveOrganizationRef(db, { inn: '99' }, true)).toBeNull();
  });

  it('returns null when neither externalId nor inn provided', async () => {
    const db = dbWith([{ id: 'x', externalId: 'E-X', inn: '77' }]);
    expect(await resolveOrganizationRef(db, {}, true)).toBeNull();
  });

  it('Т-24: canWrite=false (предпросмотр) — backfill externalId НЕ выполняется', async () => {
    const db = dbWith([{ id: 'b', externalId: null, inn: '77' }]);
    const r = await resolveOrganizationRef(db, { externalId: 'E2', inn: '77' }, false);
    // Организация разрешается как обычно, но запись в базу не идёт.
    expect(r).toMatchObject({ id: 'b' });
    expect(db.organization.update).not.toHaveBeenCalled();
  });
});

// `У-88`: локальный импорт выписки умеет адресовать организацию по её id в ЛК.
// Без этого организация без ИНН и без 1С-ключа (создана вручную или импортом
// по названию) не адресуема writer'ом, и платёж молча ушёл бы в `skipped`
// вместо очереди — потеря строки, а не «нужен ручной разбор».
describe('resolveOrganizationRef: адрес по id ЛК (У-88)', () => {
  it('находит организацию по id, не трогая externalId и inn', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const findUnique = vi
      .fn()
      .mockResolvedValue({ id: 'org-1', partnerId: null, companyId: 'c1', externalId: null });
    const db = { organization: { findFirst, findUnique, update: vi.fn() } } as never;

    const res = await resolveOrganizationRef(db, { id: 'org-1' }, false);

    expect(res).toMatchObject({ id: 'org-1', companyId: 'c1' });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      select: { id: true, partnerId: true, companyId: true, externalId: true },
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('id важнее ИНН: адрес ЛК точнее, чем поиск по реквизиту', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue({ id: 'org-1', partnerId: null, companyId: 'c1', externalId: null });
    const findFirst = vi.fn().mockResolvedValue({ id: 'org-other', companyId: 'c2' });
    const db = { organization: { findFirst, findUnique, update: vi.fn() } } as never;

    const res = await resolveOrganizationRef(db, { id: 'org-1', inn: '7707083893' }, false);

    expect(res).toMatchObject({ id: 'org-1' });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('несуществующий id → падаем на прежние ступени (externalId/ИНН)', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const findFirst = vi
      .fn()
      .mockResolvedValue({ id: 'by-inn', partnerId: null, companyId: 'c1', externalId: null });
    const db = { organization: { findFirst, findUnique, update: vi.fn() } } as never;

    const res = await resolveOrganizationRef(db, { id: 'gone', inn: '7707083893' }, false);

    expect(res).toMatchObject({ id: 'by-inn' });
  });
});
