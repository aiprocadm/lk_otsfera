import { describe, it, expectTypeOf } from 'vitest';
import type { SyncLog } from '@prisma/client';

describe('SyncLog model', () => {
  it('records entity, direction, operation, status, error, payload', () => {
    expectTypeOf<SyncLog>().toHaveProperty('entity');
    expectTypeOf<SyncLog>().toHaveProperty('externalId');
    expectTypeOf<SyncLog>().toHaveProperty('direction');
    expectTypeOf<SyncLog>().toHaveProperty('operation');
    expectTypeOf<SyncLog>().toHaveProperty('status');
    expectTypeOf<SyncLog>().toHaveProperty('errorMessage');
    expectTypeOf<SyncLog>().toHaveProperty('payload');
    expectTypeOf<SyncLog>().toHaveProperty('durationMs');
  });
});
