import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createMock1cServer, type ScenarioRef } from './server';
import { createDataset } from './core/dataset';
import { createLeadStore } from './core/leads';
import { DEFAULT_SCENARIO } from './core/scenario';
import { RestOneCAdapter } from '@/lib/services/oneCSync/adapter-rest';

let server: Server;
let baseUrl: string;
const scenarioRef: ScenarioRef = { current: { ...DEFAULT_SCENARIO } };
const leadStore = createLeadStore();

beforeAll(async () => {
  server = createMock1cServer({ scenarioRef, token: 'tok', dataset: createDataset(), leadStore });
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
