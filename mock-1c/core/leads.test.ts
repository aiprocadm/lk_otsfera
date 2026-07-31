import { describe, it, expect } from 'vitest';
import { createLeadStore } from './leads';

const body = {
  partnerSlug: 'acme',
  cabinetLeadId: 'L1',
  clientCompanyName: 'c',
  subject: 's',
  productType: ['training'],
};
const now = () => new Date('2026-06-06T00:00:00Z');

describe('createLeadStore', () => {
  it('accepts a lead and returns acceptedAt + a request id', () => {
    const store = createLeadStore();
    const res = store.accept(body, 0, now);
    expect(res.status).toBe(200);
    expect(res.result?.acceptedAt).toBe('2026-06-06T00:00:00.000Z');
    expect(res.result?.oneCRequestId).toBeTruthy();
  });

  it('dedups by cabinetLeadId — second push returns the SAME request id', () => {
    const store = createLeadStore();
    const first = store.accept(body, 0, now);
    const second = store.accept({ ...body, clientCompanyName: 'changed' }, 0, now);
    expect(second.result?.oneCRequestId).toBe(first.result?.oneCRequestId);
    expect(store.state().uniqueLeads).toBe(1);
  });

  it('records which partner key field arrived (Q5 observation)', () => {
    const store = createLeadStore();
    store.accept(body, 0, now);
    expect(store.state().partnerKeyFieldsSeen).toEqual(['partnerSlug']);
  });

  it('returns 500 when pushFailRate is 1 and does not record the lead', () => {
    const store = createLeadStore();
    const res = store.accept(body, 1, now);
    expect(res.status).toBe(500);
    expect(store.state().uniqueLeads).toBe(0);
  });
});
