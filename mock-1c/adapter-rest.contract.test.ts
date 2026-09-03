import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createMock1cServer, type ScenarioRef } from './server';
import { createDataset } from './core/dataset';
import { createLeadStore } from './core/leads';
import { createDocumentStore } from './core/documents';
import { DEFAULT_SCENARIO } from './core/scenario';
import { RestOneCAdapter } from '@/lib/services/oneCSync/adapter-rest';
import type { OneCDocumentPushPayload } from '@/lib/services/oneCSync/dto';
import { documentPushPayload } from '@/__tests__/helpers/oneCDocumentPush';

let server: Server;
let baseUrl: string;
const scenarioRef: ScenarioRef = { current: { ...DEFAULT_SCENARIO } };
const leadStore = createLeadStore();
const documentStore = createDocumentStore();

beforeAll(async () => {
  server = createMock1cServer({
    scenarioRef,
    token: 'tok',
    dataset: createDataset(),
    leadStore,
    documentStore,
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  scenarioRef.current = { ...DEFAULT_SCENARIO };
});

const adapter = () => new RestOneCAdapter({ baseUrl, token: 'tok' });

describe('RestOneCAdapter against the live mock server', () => {
  it('pulls orders over HTTP with Bearer + since (bare array default)', async () => {
    const rows = await adapter().pullOrders({ since: '2026-05-10T00:00:00Z' });
    expect(rows.map((r) => r.externalId).sort()).toEqual(['1c-order-1001', '1c-order-1002']);
  });

  it('unwraps an { items: [] } envelope when the mock emits one', async () => {
    scenarioRef.current.envelope = 'items';
    const rows = await adapter().pullOrganizations({});
    expect(rows).toHaveLength(3);
  });

  it('paginates to completion: collects every record across pages, not just page 1 (Q6)', async () => {
    scenarioRef.current.pageSize = 1; // force multi-page (default dataset has 3 orgs)
    const rows = await adapter().pullOrganizations({});
    expect(rows).toHaveLength(3);
  });

  it('rejects on a wrong token (401, not retried into success)', async () => {
    const wrong = new RestOneCAdapter({ baseUrl, token: 'nope' });
    await expect(wrong.pullOrders({})).rejects.toThrow(/401/);
  });

  it('pushes a lead and dedups a retry by cabinetLeadId', async () => {
    const a = adapter();
    const lead = {
      cabinetLeadId: 'L-contract',
      clientCompanyName: 'c',
      clientContactName: 'n',
      subject: 's',
      productType: ['training'],
      partnerSlug: 'acme',
    };
    const first = await a.pushLead(lead);
    const second = await a.pushLead(lead);
    expect(first.acceptedAt).toBeTruthy();
    expect(second.oneCRequestId).toBe(first.oneCRequestId);
    expect(leadStore.state().partnerKeyFieldsSeen).toContain('partnerSlug'); // Q5
  });
});

// Этап 8 (`У-167`): тело — из общей фикстуры контракта. Mock проверяет его
// той же схемой, что и кабинет, — это и есть контрактный тест «в обе стороны».
async function mockState(): Promise<{
  documents: { uniqueDocuments: number; documents: Array<Record<string, unknown>> };
}> {
  const res = await fetch(`${baseUrl}/__state`);
  return res.json();
}

describe('RestOneCAdapter.pushDocument against the live mock server (этап 8, У-167)', () => {
  it('pushes a document: 1C answers with its externalId and /__state shows the document', async () => {
    const r = await adapter().pushDocument(documentPushPayload());
    expect(r.externalId).toMatch(/^mock-doc-/);
    const { documents } = await mockState();
    const doc = documents.documents.find((d) => d.externalId === 'doc-contract-1');
    expect(doc).toMatchObject({
      oneCExternalId: r.externalId,
      type: 'invoice',
      number: 'С-2026-17',
      version: 1,
      lines: 1,
    });
  });

  it('repeat with the SAME version is a no-op: one document, same externalId back', async () => {
    const a = adapter();
    const payload = documentPushPayload({ externalId: 'doc-contract-same' });
    const first = await a.pushDocument(payload);
    const second = await a.pushDocument(payload);
    expect(second.externalId).toBe(first.externalId);
    const { documents } = await mockState();
    const same = documents.documents.filter((d) => d.externalId === 'doc-contract-same');
    expect(same).toHaveLength(1);
    expect(same[0]).toMatchObject({ version: 1, attempts: 2 });
  });

  it('repeat with a HIGHER version updates the document in place (same 1C id, new version)', async () => {
    const a = adapter();
    const first = await a.pushDocument(documentPushPayload({ externalId: 'doc-contract-reissue' }));
    const second = await a.pushDocument(
      documentPushPayload({ externalId: 'doc-contract-reissue', version: 2, number: 'С-2026-17' })
    );
    expect(second.externalId).toBe(first.externalId);
    const { documents } = await mockState();
    const rows = documents.documents.filter((d) => d.externalId === 'doc-contract-reissue');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 2, oneCExternalId: first.externalId });
  });

  it('a LOWER version than accepted is rejected with 409 and is not retried', async () => {
    const a = adapter();
    await a.pushDocument(documentPushPayload({ externalId: 'doc-contract-old', version: 3 }));
    const before = (await mockState()).documents.documents.find(
      (d) => d.externalId === 'doc-contract-old'
    );
    await expect(
      a.pushDocument(documentPushPayload({ externalId: 'doc-contract-old', version: 2 }))
    ).rejects.toThrow(/409/);
    const after = (await mockState()).documents.documents.find(
      (d) => d.externalId === 'doc-contract-old'
    );
    // Ровно одна отвергнутая попытка: 409 не транзиентный, withRetry не повторяет.
    expect(after?.attempts).toBe(Number(before?.attempts) + 1);
    expect(after?.version).toBe(3);
  });

  it('a body without counterparty is rejected with 400 (schema-checked on the 1C side)', async () => {
    const broken = {
      ...documentPushPayload({ externalId: 'doc-contract-broken' }),
      counterparty: undefined,
    } as unknown as OneCDocumentPushPayload;
    await expect(adapter().pushDocument(broken)).rejects.toThrow(/400/);
    const { documents } = await mockState();
    expect(documents.documents.some((d) => d.externalId === 'doc-contract-broken')).toBe(false);
  });

  it('a commercial proposal is rejected with 400 — 1C never receives КП (Р-14)', async () => {
    const kp = {
      ...documentPushPayload({ externalId: 'doc-contract-kp' }),
      type: 'commercial_proposal',
    } as unknown as OneCDocumentPushPayload;
    await expect(adapter().pushDocument(kp)).rejects.toThrow(/400/);
  });
});

