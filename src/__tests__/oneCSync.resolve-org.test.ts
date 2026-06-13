import { describe, it, expect, vi } from 'vitest';
import { resolveOrganizationRef } from '@/lib/services/oneCSync/resolve-org';

function dbWith(orgs: any[]) {
  return {
    organization: {
      findFirst: vi.fn(async ({ where }: any) =>
        orgs.find(o => (where.externalId && o.externalId === where.externalId) || (where.inn && o.inn === where.inn)) ?? null),
      update: vi.fn(async () => ({})),
    },
  } as any;
}
describe('resolveOrganizationRef', () => {
  it('matches by externalId first', async () => {
    const db = dbWith([{ id:'a', externalId:'E1', inn:'77' }]);
    expect(await resolveOrganizationRef(db, { externalId:'E1' })).toMatchObject({ id:'a' });
  });
  it('falls back to inn and backfills externalId', async () => {
    const db = dbWith([{ id:'b', externalId:null, inn:'77' }]);
    const r = await resolveOrganizationRef(db, { externalId:'E2', inn:'77' });
    expect(r).toMatchObject({ id:'b' });
    expect(db.organization.update).toHaveBeenCalledWith({ where:{ id:'b' }, data:{ externalId:'E2' } });
  });
  it('returns null when nothing matches', async () => {
    expect(await resolveOrganizationRef(dbWith([]), { inn:'00' })).toBeNull();
  });
});
