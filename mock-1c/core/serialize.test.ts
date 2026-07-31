import { describe, it, expect } from 'vitest';
import { OneCOrderSchema } from '@/lib/services/oneCSync/schemas';
import { DEFAULT_SCENARIO } from './scenario';
import {
  applyDialect,
  applyDatetime,
  injectMalformed,
  injectDuplicates,
  paginate,
  wrapEnvelope,
  shapeResponse,
} from './serialize';

const order = {
  externalId: '1c-order-1001',
  title: 'T',
  organizationExternalId: '1c-org-001',
  totalAmount: 1,
  paidAmount: 1,
  vatIncluded: true,
  executionStatus: 'completed',
  financialStatus: 'paid',
  productMix: ['training'],
  updatedAt: '2026-05-12T10:00:00Z',
  paidAt: '2026-04-20T14:00:00Z',
};

describe('applyDialect (Q10)', () => {
  it('rewrites order statuses to Russian (breaks z.enum on purpose)', () => {
    const out = applyDialect(order, 'russian') as Record<string, unknown>;
    expect(out.executionStatus).toBe('Выполнен');
    expect(out.financialStatus).toBe('Оплачен');
    expect(OneCOrderSchema.safeParse(out).success).toBe(false);
  });
  it('leaves records untouched in app dialect', () => {
    expect(applyDialect(order, 'app')).toEqual(order);
  });
});

describe('applyDatetime (Q7)', () => {
  it('strips the offset (still passes the permissive zod, but is server-local)', () => {
    const out = applyDatetime(order, 'no-offset') as Record<string, unknown>;
    expect(out.updatedAt).toBe('2026-05-12T10:00:00');
    expect(out.paidAt).toBe('2026-04-20T14:00:00');
    expect(OneCOrderSchema.safeParse(out).success).toBe(true); // silent hazard, not quarantine
  });
});

describe('injectMalformed / injectDuplicates', () => {
  it('appends one schema-breaking record when rate > 0', () => {
    const out = injectMalformed([order], 0.5);
    expect(out).toHaveLength(2);
    expect(OneCOrderSchema.safeParse(out[1]).success).toBe(false);
  });
  it('repeats the first record when duplicates on', () => {
    const out = injectDuplicates([order]);
    expect(out).toHaveLength(2);
    expect((out[1] as Record<string, unknown>).externalId).toBe('1c-order-1001');
  });
});

describe('paginate (Q6) + wrapEnvelope (Q1)', () => {
  it('serves only the first page and reports the rest in meta', () => {
    const { page, meta } = paginate(
      [order, { ...order, externalId: 'b' }, { ...order, externalId: 'c' }],
      2
    );
    expect(page).toHaveLength(2);
    expect(meta).toEqual({ total: 3, pages: 2, served: 2 });
  });
  it('wraps per envelope flag', () => {
    expect(wrapEnvelope([order], 'array')).toEqual([order]);
    expect(wrapEnvelope([order], 'items')).toEqual({ items: [order] });
    expect(wrapEnvelope([order], 'other')).toEqual({ data: [order] });
  });
});

describe('shapeResponse (composition)', () => {
  it('paginating forces an { items, nextCursor } body regardless of envelope flag', () => {
    const records = [order, { ...order, externalId: 'b' }, { ...order, externalId: 'c' }];
    const { body, meta } = shapeResponse(records, {
      ...DEFAULT_SCENARIO,
      pageSize: 2,
      envelope: 'array',
    });
    expect(Array.isArray((body as { items: unknown[] }).items)).toBe(true);
    expect((body as { items: unknown[] }).items).toHaveLength(2);
    expect((body as { nextCursor?: string }).nextCursor).toBeTruthy();
    expect(meta.pages).toBe(2);
  });
  it('default scenario returns a bare array unchanged', () => {
    const { body } = shapeResponse([order], DEFAULT_SCENARIO);
    expect(body).toEqual([order]);
  });
});
