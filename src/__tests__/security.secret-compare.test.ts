import { describe, it, expect } from 'vitest';
import { secretEquals } from '@/lib/security/secretCompare';

describe('secretEquals', () => {
  it('true при точном совпадении', () => {
    expect(secretEquals('s3cret-value', 's3cret-value')).toBe(true);
  });

  it('false при несовпадении той же длины', () => {
    expect(secretEquals('s3cret-value', 's3cret-vAlue')).toBe(false);
  });

  it('false при разной длине (sha256 выравнивает буферы — не бросает)', () => {
    expect(secretEquals('short', 'a-much-longer-expected-secret')).toBe(false);
  });

  it('false для null/undefined (отсутствующий заголовок)', () => {
    expect(secretEquals(null, 'expected')).toBe(false);
    expect(secretEquals(undefined, 'expected')).toBe(false);
  });

  it('false для пустой строки против непустого секрета', () => {
    expect(secretEquals('', 'expected')).toBe(false);
  });
});
