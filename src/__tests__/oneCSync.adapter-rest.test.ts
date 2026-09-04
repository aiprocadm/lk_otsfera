import { describe, expect, it, vi, afterEach } from 'vitest';
import { RestOneCAdapter } from '@/lib/services/oneCSync/adapter-rest';
import { documentPushPayload } from '@/__tests__/helpers/oneCDocumentPush';
import {
  buildLeadBody,
  PARTNER_KEY_FIELD,
  parseEnvelope,
  normalizeOrderRecord,
  buildUrl,
} from '@/lib/services/oneCSync/rest-wire';

const config = { baseUrl: 'https://1c.example.com', token: 'tok' };
const validOrder = {
  externalId: '1c-order-1',
  title: 'T',
  organizationExternalId: '1c-org-1',
  totalAmount: 100,
  paidAmount: 50,
  vatIncluded: true,
  executionStatus: 'in_progress',
  financialStatus: 'partially_paid',
  productMix: ['training'],
  updatedAt: '2026-05-01T00:00:00Z',
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [validOrder] }) })
    );
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
    expect((rows[0] as unknown as Record<string, unknown>).financialStatus).toBe(
      'Марсианский статус'
    );
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ items: [validOrder] }) });
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: { get: () => null },
        json: async () => ({}),
      })
    );
    await expect(new RestOneCAdapter(config).pullOrders({})).rejects.toThrow(/500/);
  });

  it('pushLead POSTs and validates the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ acceptedAt: '2026-05-01T00:00:00Z', oneCRequestId: 'r1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await new RestOneCAdapter(config).pushLead({
      cabinetLeadId: 'l',
      clientCompanyName: 'c',
      clientContactName: 'n',
      subject: 's',
      productType: [],
    });
    expect(r.oneCRequestId).toBe('r1');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  // Этап 8 (`У-167`): выгрузка документа — POST на тот же путь, что и чтение
  // документов (`/api/documents`); тело уходит как есть, ответ проверяется схемой.
  it('pushDocument POSTs the payload to /api/documents with Bearer and parses { externalId }', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ externalId: '1c-doc-77' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const payload = documentPushPayload();
    const r = await new RestOneCAdapter(config).pushDocument(payload);
    expect(r).toEqual({ externalId: '1c-doc-77' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://1c.example.com/api/documents');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it('pushDocument rejects a 1C answer without externalId (schema-checked)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    );
    await expect(new RestOneCAdapter(config).pushDocument(documentPushPayload())).rejects.toThrow();
  });

  it('pushDocument throws on 409 (older version) and does NOT retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      headers: { get: () => null },
      json: async () => ({ error: 'version 1 is below accepted 2' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const err = await new RestOneCAdapter(config)
      .pushDocument(documentPushPayload())
      .catch((e) => e);
    expect(err.status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Этап 8 (`У-172`): сверка — точечный GET по externalId кабинета (контракт §7).
  it('findDocument GETs /api/documents?externalId= with Bearer and returns the single item', async () => {
    const doc = { externalId: '1c-doc-77', orderExternalId: '1c-order-1', type: 'invoice' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [doc] });
    vi.stubGlobal('fetch', fetchMock);
    const r = await new RestOneCAdapter(config).findDocument('doc-cab-1');
    expect(r).toEqual(doc);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://1c.example.com/api/documents?externalId=doc-cab-1');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('findDocument returns null on an empty answer — «в 1С такого нет»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    expect(await new RestOneCAdapter(config).findDocument('doc-cab-1')).toBeNull();
  });

  it('findDocument unwraps an { items: [] } envelope too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ externalId: 'x' }] }) })
    );
    expect(await new RestOneCAdapter(config).findDocument('doc-cab-1')).toEqual({
      externalId: 'x',
    });
  });

  it('findDocument throws on a non-OK response — транспортная ошибка, не «пропал»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: { get: () => null },
        json: async () => ({}),
      })
    );
    const err = await new RestOneCAdapter(config).findDocument('doc-cab-1').catch((e) => e);
    expect(err.status).toBe(500);
  });

  it('pullPayments returns payments array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    const rows = await new RestOneCAdapter(config).pullPayments({});
    expect(Array.isArray(rows)).toBe(true);
  });

  it('pullDocuments returns documents array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    const rows = await new RestOneCAdapter(config).pullDocuments({});
    expect(Array.isArray(rows)).toBe(true);
  });

  it('sets retryAfter on error when Retry-After header > 0 (400 = no retry, fast test)', async () => {
    // 400 is a fatal (non-transient) error → withRetry throws immediately, no retry loop.
    // This exercises the retryAfterHeader > 0 branch in doFetch (line 20).
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: { get: (h: string) => (h === 'retry-after' ? '3' : null) },
        json: async () => ({}),
      })
    );
    const adapter = new RestOneCAdapter(config);
    const err = await adapter.pullOrders({}).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.retryAfter).toBe(3); // truthy header value passes through
  });

  it('sets retryAfter to undefined when Retry-After header is 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: { get: (h: string) => (h === 'retry-after' ? '0' : null) },
        json: async () => ({}),
      })
    );
    const adapter = new RestOneCAdapter(config);
    const err = await adapter.pullOrders({}).catch((e) => e);
    expect(err.retryAfter).toBeUndefined(); // 0 is not > 0 → undefined
  });
});

describe('parseEnvelope', () => {
  it('returns items and nextCursor from object envelope', () => {
    const result = parseEnvelope({ items: [1, 2], nextCursor: 'abc' });
    expect(result.items).toEqual([1, 2]);
    expect(result.nextCursor).toBe('abc');
  });

  it('ignores empty-string nextCursor (returns undefined)', () => {
    const result = parseEnvelope({ items: [], nextCursor: '' });
    expect(result.nextCursor).toBeUndefined();
  });

  it('throws on unexpected envelope shape (not array, not {items})', () => {
    expect(() => parseEnvelope({ notItems: [] })).toThrow('Unexpected 1C response envelope');
    expect(() => parseEnvelope(42)).toThrow('Unexpected 1C response envelope');
    expect(() => parseEnvelope(null)).toThrow('Unexpected 1C response envelope');
  });
});

describe('normalizeOrderRecord', () => {
  it('passes through non-object values unchanged', () => {
    expect(normalizeOrderRecord(null)).toBeNull();
    expect(normalizeOrderRecord(42)).toBe(42);
    expect(normalizeOrderRecord('str')).toBe('str');
  });

  it('passes through when financialStatus and executionStatus are absent', () => {
    const rec = { externalId: 'x', totalAmount: 100 };
    expect(normalizeOrderRecord(rec)).toMatchObject(rec);
  });

  it('keeps unknown statuses unchanged (zod quarantines them downstream)', () => {
    const rec = { financialStatus: 'Марсианский', executionStatus: 'Неизвестно' };
    const out = normalizeOrderRecord(rec) as Record<string, unknown>;
    expect(out.financialStatus).toBe('Марсианский');
    expect(out.executionStatus).toBe('Неизвестно');
  });
});

describe('buildUrl', () => {
  it('sets since param when cursor.since is present', () => {
    const url = buildUrl('https://1c.example.com', '/api/orders', {
      since: '2026-01-01T00:00:00Z',
    });
    expect(url).toContain('since=');
  });

  it('omits since param when cursor has no since', () => {
    const url = buildUrl('https://1c.example.com', '/api/orders', {});
    expect(url).not.toContain('since=');
  });

  it('sets cursor param when pageCursor is provided', () => {
    const url = buildUrl('https://1c.example.com', '/api/orders', {}, 'page2');
    expect(url).toContain('cursor=page2');
  });
});

describe('buildLeadBody (Q5 partner key)', () => {
  it('defaults to keying on Partner.slug under `partnerSlug`', () => {
    expect(PARTNER_KEY_FIELD).toBe('partnerSlug');
    const body = buildLeadBody({
      partnerSlug: 'acme',
      cabinetLeadId: 'l1',
      clientCompanyName: 'c',
      clientContactName: 'n',
      subject: 's',
      productType: ['training'],
    }) as Record<string, unknown>;
    expect(body.partnerSlug).toBe('acme');
    expect('partnerExternalId' in body).toBe(false); // never double-emit the key
    expect(body.cabinetLeadId).toBe('l1');
    expect(body.productType).toEqual(['training']);
  });

  it('omits the partner field on the wire when the slug is absent', () => {
    const body = buildLeadBody({
      cabinetLeadId: 'l2',
      clientCompanyName: 'c',
      clientContactName: 'n',
      subject: 's',
      productType: [],
    }) as Record<string, unknown>;
    expect(body.partnerSlug).toBeUndefined();
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('partnerSlug');
  });
});
