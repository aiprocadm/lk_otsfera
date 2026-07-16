import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  listFunnelStages,
  createFunnelStage,
  updateFunnelStage,
  deleteFunnelStage,
  type FunnelStageInput
} from '@/lib/services/access/funnelStages';
import type { SessionPayload } from '@/lib/auth/jwt';

/** G2.4 — FunnelStage CRUD против Postgres. Company-scope, аудит, position_taken. */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string, companyB: string, leaderAId: string, plainMgrAId: string, userBId: string, partnerId: string;

const leaderA = (): SessionPayload =>
  ({ sub: leaderAId, role: 'manager', managerRole: 'leader', companyId: companyA } as unknown as SessionPayload);
const plainMgrA = (): SessionPayload =>
  ({ sub: plainMgrAId, role: 'manager', companyId: companyA } as unknown as SessionPayload);
const adminB = (): SessionPayload => ({ sub: userBId, role: 'admin', companyId: companyB } as unknown as SessionPayload);

const input = (over: Partial<FunnelStageInput> = {}): FunnelStageInput => ({
  name: `Стадия-${STAMP}`, position: 0, statusAnchor: 'qualified', color: null, isTerminal: false, ...over
});

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `fsA-${STAMP}` } })).id;
  companyB = (await prisma.company.create({ data: { name: `fsB-${STAMP}` } })).id;
  leaderAId = (await prisma.user.create({ data: { email: `fsLeader-${STAMP}@t.local`, name: 'L', role: 'manager', managerRole: 'leader', companyId: companyA } })).id;
  plainMgrAId = (await prisma.user.create({ data: { email: `fsMgr-${STAMP}@t.local`, name: 'M', role: 'manager', companyId: companyA } })).id;
  userBId = (await prisma.user.create({ data: { email: `fsUserB-${STAMP}@t.local`, name: 'B', role: 'admin', companyId: companyB } })).id;
  partnerId = (await prisma.partner.create({ data: { name: `fsP-${STAMP}`, slug: `fsP-${STAMP}` } })).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: [leaderAId, plainMgrAId, userBId] } } });
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.funnelStage.deleteMany({ where: { companyId: { in: [companyA, companyB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [leaderAId, plainMgrAId, userBId] } } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('createFunnelStage', () => {
  it('leader creates; appears in list', async () => {
    const res = await createFunnelStage(prisma, leaderA(), input({ name: `Предложение-${STAMP}`, position: 10 }));
    expect(res.ok).toBe(true);
    const list = await listFunnelStages(prisma, leaderA());
    expect(list.ok && list.rows.some((r) => r.name === `Предложение-${STAMP}`)).toBe(true);
  });
  it('duplicate position in company → position_taken', async () => {
    await createFunnelStage(prisma, leaderA(), input({ position: 20 }));
    expect(await createFunnelStage(prisma, leaderA(), input({ position: 20 }))).toEqual({ ok: false, error: 'position_taken' });
  });
  it('empty name → validation', async () => {
    expect(await createFunnelStage(prisma, leaderA(), input({ name: '  ', position: 30 }))).toEqual({ ok: false, error: 'validation' });
  });
  it('plain manager → forbidden', async () => {
    expect(await createFunnelStage(prisma, plainMgrA(), input({ position: 40 }))).toEqual({ ok: false, error: 'forbidden' });
  });
  it('color: не-hex строка → validation; валидный #RRGGBB → ok и сохраняется', async () => {
    expect(await createFunnelStage(prisma, leaderA(), input({ position: 70, color: '#ZZZZZZ' }))).toEqual({ ok: false, error: 'validation' });
    const ok = await createFunnelStage(prisma, leaderA(), input({ position: 70, name: `Цвет-${STAMP}`, color: '#22C55E' }));
    expect(ok.ok).toBe(true);
    const id = ok.ok ? ok.id : '';
    expect((await prisma.funnelStage.findUniqueOrThrow({ where: { id } })).color).toBe('#22C55E');
  });
  it('color: undefined → ok (nullish), сохраняется null', async () => {
    const ok = await createFunnelStage(prisma, leaderA(), input({ position: 71, name: `БезЦвета-${STAMP}`, color: undefined }));
    expect(ok.ok).toBe(true);
    const id = ok.ok ? ok.id : '';
    expect((await prisma.funnelStage.findUniqueOrThrow({ where: { id } })).color).toBeNull();
  });
});

describe('updateFunnelStage', () => {
  it('updates + audit; cross-company → not_found', async () => {
    const created = await createFunnelStage(prisma, leaderA(), input({ position: 50, name: `Upd-${STAMP}` }));
    const id = created.ok ? created.id : '';
    expect(await updateFunnelStage(prisma, leaderA(), id, input({ position: 50, name: `Upd2-${STAMP}`, isTerminal: true }))).toEqual({ ok: true });
    const row = await prisma.funnelStage.findUniqueOrThrow({ where: { id } });
    expect(row.name).toBe(`Upd2-${STAMP}`);
    expect(row.isTerminal).toBe(true);
    expect(await prisma.auditLog.findFirst({ where: { entity: 'funnel_stage', entityId: id, action: 'funnel_stage_updated' } })).not.toBeNull();

    const inB = await createFunnelStage(prisma, adminB(), input({ position: 1, name: `B-${STAMP}` }));
    const idB = inB.ok ? inB.id : '';
    expect(await updateFunnelStage(prisma, leaderA(), idB, input({ position: 1 }))).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('deleteFunnelStage', () => {
  it('deletes; assigned lead funnelStageId nulled (FK SET NULL)', async () => {
    const created = await createFunnelStage(prisma, leaderA(), input({ position: 60, name: `Del-${STAMP}` }));
    const id = created.ok ? created.id : '';
    const leadId = (await prisma.lead.create({
      data: { partnerId, createdByUserId: leaderAId, clientCompanyName: 'x', clientContactName: 'y', subject: 'z', funnelStageId: id }
    })).id;
    expect(await deleteFunnelStage(prisma, leaderA(), id)).toEqual({ ok: true });
    expect(await prisma.funnelStage.findUnique({ where: { id } })).toBeNull();
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).funnelStageId).toBeNull();
  });
  it('cross-company delete → not_found', async () => {
    const inB = await createFunnelStage(prisma, adminB(), input({ position: 2, name: `DelB-${STAMP}` }));
    const idB = inB.ok ? inB.id : '';
    expect(await deleteFunnelStage(prisma, leaderA(), idB)).toEqual({ ok: false, error: 'not_found' });
  });
});
