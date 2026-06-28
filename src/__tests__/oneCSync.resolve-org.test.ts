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
    expect(r).toMatchObject({ id:'b', externalId:'E2' });
    expect(db.organization.update).toHaveBeenCalledWith({ where:{ id:'b' }, data:{ externalId:'E2' } });
  });
  it('returns null when nothing matches', async () => {
    expect(await resolveOrganizationRef(dbWith([]), { inn:'00' })).toBeNull();
  });

  it('falls back to inn but does NOT update externalId if org already has one', async () => {
    // org already has externalId='E-EXISTING', ref.externalId='E2' — should NOT update
    const db = dbWith([{ id:'c', externalId:'E-EXISTING', inn:'88' }]);
    const r = await resolveOrganizationRef(db, { externalId:'E2', inn:'88' });
    expect(r).toMatchObject({ id:'c', externalId:'E-EXISTING' });
    expect(db.organization.update).not.toHaveBeenCalled();
  });

  it('returns null when only inn is provided and nothing matches', async () => {
    const db = dbWith([]);
    expect(await resolveOrganizationRef(db, { inn:'99' })).toBeNull();
  });

  it('returns null when neither externalId nor inn provided', async () => {
    const db = dbWith([{ id:'x', externalId:'E-X', inn:'77' }]);
    expect(await resolveOrganizationRef(db, {})).toBeNull();
  });
});
