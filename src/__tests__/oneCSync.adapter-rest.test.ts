import { describe, expect, it, vi, afterEach } from 'vitest';
import { RestOneCAdapter } from '@/lib/services/oneCSync/adapter-rest';

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
