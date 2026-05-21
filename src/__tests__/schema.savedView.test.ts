import { describe, it, expectTypeOf } from 'vitest';
import type { SavedView } from '@prisma/client';

describe('SavedView model', () => {
  it('has scope, filters json, share flag', () => {
    expectTypeOf<SavedView>().toHaveProperty('userId');
    expectTypeOf<SavedView>().toHaveProperty('scope');
    expectTypeOf<SavedView>().toHaveProperty('name');
    expectTypeOf<SavedView>().toHaveProperty('filters');
    expectTypeOf<SavedView>().toHaveProperty('isDefault');
    expectTypeOf<SavedView>().toHaveProperty('isShared');
  });
});
