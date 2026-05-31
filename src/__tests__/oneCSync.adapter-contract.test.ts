import { describe, expect, it, afterEach } from 'vitest';
import { FakeOneCAdapter } from '@/lib/services/oneCSync/adapter-fake';
import { OneCOrgSchema, OneCOrderSchema, OneCPaymentSchema, OneCDocumentSchema } from '@/lib/services/oneCSync/schemas';
import { parseRecords } from '@/lib/services/oneCSync/resilience';

afterEach(() => {
  delete process.env.FAKE_ONEC_MALFORMED_RATE;
});

describe('OneCAdapter contract — FakeOneCAdapter', () => {
  const adapter = new FakeOneCAdapter();

  it('pull* output validates against the schemas (clean fixtures)', async () => {
    expect(parseRecords(OneCOrgSchema, await adapter.pullOrganizations({})).invalid).toHaveLength(0);
    expect(parseRecords(OneCOrderSchema, await adapter.pullOrders({})).invalid).toHaveLength(0);
    expect(parseRecords(OneCPaymentSchema, await adapter.pullPayments({})).invalid).toHaveLength(0);
    expect(parseRecords(OneCDocumentSchema, await adapter.pullDocuments({})).invalid).toHaveLength(0);
  });

  it('honours the since cursor (returns only newer records)', async () => {
    const all = await adapter.pullOrders({});
    const maxTs = all.map((o) => o.updatedAt).sort().at(-1)!;
    const after = await adapter.pullOrders({ since: maxTs });
    expect(after).toHaveLength(0);
  });

  it('pushLead returns an acceptedAt', async () => {
    const r = await adapter.pushLead({ cabinetLeadId: 'l', clientCompanyName: 'c', clientContactName: 'n', subject: 's', productType: [] });
    expect(r.acceptedAt).toBeTruthy();
  });

  it('FAKE_ONEC_MALFORMED_RATE=1 injects a record that fails validation (exercises quarantine)', async () => {
    process.env.FAKE_ONEC_MALFORMED_RATE = '1';
    const raw = await adapter.pullOrders({});
    const { invalid } = parseRecords(OneCOrderSchema, raw);
    expect(invalid.length).toBeGreaterThan(0);
  });
});
