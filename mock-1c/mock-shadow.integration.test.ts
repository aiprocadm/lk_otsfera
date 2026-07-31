import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { createMock1cServer, type ScenarioRef } from './server';
import { createDataset } from './core/dataset';
import { createLeadStore } from './core/leads';
import { DEFAULT_SCENARIO } from './core/scenario';
import { syncOrdersProcessor } from '@/worker/processors/sync-orders';
import { resetOneCAdapter } from '@/lib/services/oneCSync';

const prisma = new PrismaClient();
let server: Server;
const scenarioRef: ScenarioRef = { current: { ...DEFAULT_SCENARIO } };

beforeAll(async () => {
  server = createMock1cServer({
    scenarioRef,
    token: 'tok',
    dataset: createDataset(),
    leadStore: createLeadStore(),
  });
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  process.env.ONE_C_ADAPTER = 'rest';
  process.env.ONE_C_API_URL = `http://127.0.0.1:${port}`;
  process.env.ONE_C_API_TOKEN = 'tok';
  process.env.ONE_C_MODE = 'shadow';
  resetOneCAdapter();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
  delete process.env.ONE_C_ADAPTER;
  delete process.env.ONE_C_API_URL;
  delete process.env.ONE_C_API_TOKEN;
  delete process.env.ONE_C_MODE;
  resetOneCAdapter();
});

beforeEach(async () => {
  await prisma.syncLog.deleteMany({ where: { entity: 'order' } });
});

describe('shadow sync against the mock writes nothing but logs a check', () => {
  it('runs the order processor in shadow mode', async () => {
    const fakeJob = { id: 'mock-shadow' } as unknown as Parameters<typeof syncOrdersProcessor>[0];
    const before = await prisma.order.count();
    await syncOrdersProcessor(fakeJob, prisma);
    expect(await prisma.order.count()).toBe(before); // shadow = no writes

    const checks = await prisma.syncLog.findMany({
      where: { entity: 'order', operation: 'check' },
    });
    expect(checks.length).toBeGreaterThan(0);
  });
});
