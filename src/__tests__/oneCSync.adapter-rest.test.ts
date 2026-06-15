import { describe, expect, it, vi, afterEach } from 'vitest';
import { RestOneCAdapter } from '@/lib/services/oneCSync/adapter-rest';
import { buildLeadBody, PARTNER_KEY_FIELD } from '@/lib/services/oneCSync/rest-wire';

const config = { baseUrl: 'https://1c.example.com', token: 'tok' };
const validOrder = {
  externalId: '1c-order-1', title: 'T', organizationExternalId: '1c-org-1',
  totalAmount: 100, paidAmount: 50, vatIncluded: true,
  executionStatus: 'in_progress', financialStatus: 'partially_paid',
  productMix: ['training'], updatedAt: '2026-05-01T00:00:00Z'
};

afterEach(() => vi.unstubAllGlobals());

describe('RestOneCAdapter', () => {
  it('fetches with Bearer auth + since param and returns a bare JSON array', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [validOrder] });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new RestOneCAdapter(config);
    const rows = await adapter.pullOrders({ since: '2026-04-01T00:00:00Z' });

    expect(rows).toEqual([validOrder]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/orders');
    expect(String(url)).toContain('since=2026-04-01T00%3A00%3A00Z');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('unwraps an { items: [] } envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [validOrder] }) }));
    const rows = await new RestOneCAdapter(config).pullOrders({});
    expect(rows).toHaveLength(1);
  });

  // Q10: 1C natively emits Russian status names; the REST adapter must translate
  // them to internal enum codes (parity with the file adapter) or every order
  // would fail the downstream zod gate.
  it('translates Russian order statuses to internal codes (Q10)', async () => {
    const ruOrder = { ...validOrder, financialStatus: 'Оплачено', executionStatus: 'Выполнен' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [ruOrder] }));
    const rows = await new RestOneCAdapter(config).pullOrders({});
    expect(rows[0].financialStatus).toBe('paid');
    expect(rows[0].executionStatus).toBe('completed');
  });

  it('leaves already-internal order statuses unchanged (idempotent)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [validOrder] }));
    const rows = await new RestOneCAdapter(config).pullOrders({});
    expect(rows[0].financialStatus).toBe('partially_paid');
    expect(rows[0].executionStatus).toBe('in_progress');
  });

  it('leaves an unknown status as-is (downstream zod quarantines it)', async () => {
    const bad = { ...validOrder, financialStatus: 'Марсианский статус' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [bad] }));
    const rows = await new RestOneCAdapter(config).pullOrders({});
    expect((rows[0] as unknown as Record<string, unknown>).financialStatus).toBe('Марсианский статус');
  });

  // Q6: the adapter must follow nextCursor to exhaustion, else only page 1 is
  // ingested and the cursor advances past the unfetched rest (silent undercount).
  it('follows nextCursor across pages and accumulates all records (Q6)', async () => {
    const page1 = { items: [{ ...validOrder, externalId: 'o1' }], nextCursor: 'c2' };
    const page2 = { items: [{ ...validOrder, externalId: 'o2' }] }; // no nextCursor → stop
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page1 })
      .mockResolvedValueOnce({ ok: true, json: async () => page2 });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await new RestOneCAdapter(config).pullOrders({ since: '2026-04-01T00:00:00Z' });

    expect(rows.map((r) => r.externalId)).toEqual(['o1', 'o2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Page 2 request carries the page cursor AND still carries the since filter.
    const page2Url = String(fetchMock.mock.calls[1][0]);
    expect(page2Url).toContain('cursor=c2');
    expect(page2Url).toContain('since=2026-04-01');
  });

  it('stops after one page when no nextCursor is returned', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [validOrder] }) });
    vi.stubGlobal('fetch', fetchMock);
    await new RestOneCAdapter(config).pullOrders({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('paginates every entity, not just orders (shared getArray)', async () => {
    const page1 = { items: [{ externalId: 'org1' }], nextCursor: 'p2' };
    const page2 = { items: [{ externalId: 'org2' }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page1 })
      .mockResolvedValueOnce({ ok: true, json: async () => page2 });
    vi.stubGlobal('fetch', fetchMock);
    const rows = await new RestOneCAdapter(config).pullOrganizations({});
    expect(rows).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws OneCHttpError on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) }));
    await expect(new RestOneCAdapter(config).pullOrders({})).rejects.toThrow(/500/);
  });

  it('pushLead POSTs and validates the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ acceptedAt: '2026-05-01T00:00:00Z', oneCRequestId: 'r1' }) });
    vi.stubGlobal('fetch', fetchMock);
    const r = await new RestOneCAdapter(config).pushLead({ cabinetLeadId: 'l', clientCompanyName: 'c', clientContactName: 'n', subject: 's', productType: [] });
    expect(r.oneCRequestId).toBe('r1');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });
});

describe('buildLeadBody (Q5 partner key)', () => {
  it('defaults to keying on Partner.slug under `partnerSlug`', () => {
    expect(PARTNER_KEY_FIELD).toBe('partnerSlug');
    const body = buildLeadBody({
      partnerSlug: 'acme', cabinetLeadId: 'l1', clientCompanyName: 'c',
      clientContactName: 'n', subject: 's', productType: ['training']
    }) as Record<string, unknown>;
    expect(body.partnerSlug).toBe('acme');
    expect('partnerExternalId' in body).toBe(false); // never double-emit the key
    expect(body.cabinetLeadId).toBe('l1');
    expect(body.productType).toEqual(['training']);
  });

  it('omits the partner field on the wire when the slug is absent', () => {
    const body = buildLeadBody({
      cabinetLeadId: 'l2', clientCompanyName: 'c', clientContactName: 'n',
      subject: 's', productType: []
    }) as Record<string, unknown>;
    expect(body.partnerSlug).toBeUndefined();
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('partnerSlug');
  });
});
