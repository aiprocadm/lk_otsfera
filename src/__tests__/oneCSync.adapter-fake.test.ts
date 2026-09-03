import { describe, expect, it } from 'vitest';
import { FakeOneCAdapter } from '@/lib/services/oneCSync/adapter-fake';
import { documentPushPayload } from '@/__tests__/helpers/oneCDocumentPush';

describe('FakeOneCAdapter', () => {
  it('returns at least 3 organizations', async () => {
    const a = new FakeOneCAdapter();
    const orgs = await a.pullOrganizations({});
    expect(orgs.length).toBeGreaterThanOrEqual(3);
    expect(orgs[0]).toHaveProperty('externalId');
    expect(orgs[0]).toHaveProperty('name');
  });

  it('returns orders linked to organizations', async () => {
    const a = new FakeOneCAdapter();
    const orgs = await a.pullOrganizations({});
    const orders = await a.pullOrders({});
    const orgIds = new Set(orgs.map((o) => o.externalId));
    expect(orders.length).toBeGreaterThan(0);
    for (const order of orders) {
      expect(orgIds.has(order.organizationExternalId!)).toBe(true);
    }
  });

  it('respects cursor.since for incremental sync', async () => {
    const a = new FakeOneCAdapter();
    const all = await a.pullOrders({});
    const recent = await a.pullOrders({ since: '2050-01-01T00:00:00Z' });
    expect(recent.length).toBe(0);
    expect(all.length).toBeGreaterThan(recent.length);
  });

  it('pushLead returns acceptedAt timestamp', async () => {
    const a = new FakeOneCAdapter();
    const result = await a.pushLead({
      cabinetLeadId: 'lead-1',
      clientCompanyName: 'X',
      clientContactName: 'Y',
      subject: 'Z',
      productType: ['training'],
    });
    expect(result.acceptedAt).toBeTruthy();
  });

  it('pullPayments returns payments and respects cursor.since', async () => {
    const a = new FakeOneCAdapter();
    const all = await a.pullPayments({});
    // FAKE_PAYMENTS may be empty array — test the shape when non-empty, else just that it's an array
    expect(Array.isArray(all)).toBe(true);
    const none = await a.pullPayments({ since: '2099-01-01T00:00:00Z' });
    expect(none).toHaveLength(0);
  });

  it('pullDocuments returns documents and respects cursor.since', async () => {
    const a = new FakeOneCAdapter();
    const all = await a.pullDocuments({});
    expect(Array.isArray(all)).toBe(true);
    const none = await a.pullDocuments({ since: '2099-01-01T00:00:00Z' });
    expect(none).toHaveLength(0);
  });

  it('injects a malformed record when FAKE_ONEC_MALFORMED_RATE > 0', async () => {
    const prev = process.env.FAKE_ONEC_MALFORMED_RATE;
    process.env.FAKE_ONEC_MALFORMED_RATE = '1'; // 100% injection
    try {
      const a = new FakeOneCAdapter();
      const orders = await a.pullOrders({});
      const malformed = orders.find(
        (o) => (o as unknown as Record<string, unknown>).broken === true
      );
      expect(malformed).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env.FAKE_ONEC_MALFORMED_RATE;
      else process.env.FAKE_ONEC_MALFORMED_RATE = prev;
    }
  });

  it('adds latency when FAKE_ONEC_LATENCY_MS is set', async () => {
    const prev = process.env.FAKE_ONEC_LATENCY_MS;
    process.env.FAKE_ONEC_LATENCY_MS = '1'; // 1ms — fast but exercises the branch
    try {
      const a = new FakeOneCAdapter();
      const orgs = await a.pullOrganizations({});
      expect(Array.isArray(orgs)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.FAKE_ONEC_LATENCY_MS;
      else process.env.FAKE_ONEC_LATENCY_MS = prev;
    }
  });

  it('simulates pushLead failure when FAKE_ONEC_FAILURE_RATE=1', async () => {
    const prev = process.env.FAKE_ONEC_FAILURE_RATE;
    process.env.FAKE_ONEC_FAILURE_RATE = '1'; // 100% failure
    try {
      const a = new FakeOneCAdapter();
      await expect(
        a.pushLead({
          cabinetLeadId: 'lead-fail',
          clientCompanyName: 'X',
          clientContactName: 'Y',
          subject: 'Z',
          productType: [],
        })
      ).rejects.toThrow(/FakeOneC simulated failure/);
    } finally {
      if (prev === undefined) delete process.env.FAKE_ONEC_FAILURE_RATE;
      else process.env.FAKE_ONEC_FAILURE_RATE = prev;
    }
  });

  // Этап 8 (`У-167`): ответ выводится из externalId кабинета, а не из времени —
  // повтор той же версии обязан вернуть тот же идентификатор.
  it('pushDocument answers a deterministic 1c-doc-<externalId> and repeats it on retry', async () => {
    const a = new FakeOneCAdapter();
    const first = await a.pushDocument(documentPushPayload({ externalId: 'doc-42' }));
    const second = await a.pushDocument(documentPushPayload({ externalId: 'doc-42', version: 2 }));
    expect(first).toEqual({ externalId: '1c-doc-doc-42' });
    expect(second).toEqual(first);
  });

  it('simulates pushDocument failure when FAKE_ONEC_FAILURE_RATE=1', async () => {
    const prev = process.env.FAKE_ONEC_FAILURE_RATE;
    process.env.FAKE_ONEC_FAILURE_RATE = '1';
    try {
      await expect(new FakeOneCAdapter().pushDocument(documentPushPayload())).rejects.toThrow(
        /FakeOneC simulated failure .* for document doc-contract-1 v1/
      );
    } finally {
      if (prev === undefined) delete process.env.FAKE_ONEC_FAILURE_RATE;
      else process.env.FAKE_ONEC_FAILURE_RATE = prev;
    }
  });
});

