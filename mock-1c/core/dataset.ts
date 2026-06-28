import { FAKE_ORGS } from '@/lib/services/oneCSync/fixtures/orgs';
import { FAKE_ORDERS, FAKE_PAYMENTS, FAKE_DOCUMENTS } from '@/lib/services/oneCSync/fixtures/orders';
import type { SyncCursor } from '@/lib/services/oneCSync/dto';

export type Entity = 'organization' | 'order' | 'payment' | 'document';
type Rec = Record<string, unknown> & { externalId: string; updatedAt: string };

function seed(): Record<Entity, Rec[]> {
  // Deep copy so the store is mutable (touch) without corrupting the imported fixtures.
  const clone = (rows: ReadonlyArray<Record<string, unknown>>): Rec[] =>
    rows.map((r) => ({ ...r })) as Rec[];
  return {
    organization: clone(FAKE_ORGS),
    order: clone(FAKE_ORDERS),
    payment: clone(FAKE_PAYMENTS),
    document: clone(FAKE_DOCUMENTS)
  };
}

export type Dataset = {
  list(entity: Entity, cursor: SyncCursor): Rec[];
  touch(entity: Entity, externalId: string, now?: () => Date): void;
};

export function createDataset(initial: Record<Entity, Rec[]> = seed()): Dataset {
  const store = initial;
  return {
    list(entity, cursor) {
      const rows = store[entity];
      const filtered = cursor.since
        ? rows.filter((r) => Date.parse(r.updatedAt) > Date.parse(cursor.since as string))
        : rows;
      return filtered.map((r) => ({ ...r })); // hand out copies
    },
    touch(entity, externalId, now = () => new Date()) {
      const row = store[entity].find((r) => r.externalId === externalId);
      if (row) row.updatedAt = now().toISOString();
    }
  };
}
