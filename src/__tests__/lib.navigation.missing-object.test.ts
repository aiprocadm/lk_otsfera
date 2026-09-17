import { describe, it, expect } from 'vitest';
import {
  MISSING_OBJECT_PARAM,
  isMissingObjectRequested,
  missingObjectHref,
} from '@/lib/navigation/missingObject';

/**
 * «Объект недоступен» (`У-232`, спека §3.7): карточка строит адрес списка с
 * пометкой, список её читает. Обе стороны обязаны понимать друг друга —
 * иначе редирект приведёт в список без объяснения.
 */
describe('missingObjectHref', () => {
  it('к пути без параметров добавляет ?missing=1', () => {
    expect(missingObjectHref('/manager/orders')).toBe('/manager/orders?missing=1');
  });

  it('к пути с параметрами добавляет через &, не ломая уже стоящие', () => {
    expect(missingObjectHref('/organization/orders?org=org-1')).toBe(
      '/organization/orders?org=org-1&missing=1'
    );
  });

  it('имя параметра — одно на обе стороны', () => {
    expect(missingObjectHref('/x')).toBe(`/x?${MISSING_OBJECT_PARAM}=1`);
  });
});

describe('isMissingObjectRequested', () => {
  it("'1' → пришли по ссылке на недоступный объект", () => {
    expect(isMissingObjectRequested({ missing: '1' })).toBe(true);
  });

  it('массив значений с единицей — тоже да (параметр повторили)', () => {
    expect(isMissingObjectRequested({ missing: ['0', '1'] })).toBe(true);
  });

  it('нет параметра, нет searchParams или другое значение → нет', () => {
    expect(isMissingObjectRequested({})).toBe(false);
    expect(isMissingObjectRequested(undefined)).toBe(false);
    expect(isMissingObjectRequested({ missing: '0' })).toBe(false);
    expect(isMissingObjectRequested({ missing: 'true' })).toBe(false);
    expect(isMissingObjectRequested({ missing: ['0'] })).toBe(false);
  });

  it('адрес, построенный missingObjectHref, распознаётся обратно', () => {
    const qs = new URL(missingObjectHref('/leader/tasks'), 'http://x').searchParams;
    expect(isMissingObjectRequested(Object.fromEntries(qs))).toBe(true);
  });
});
