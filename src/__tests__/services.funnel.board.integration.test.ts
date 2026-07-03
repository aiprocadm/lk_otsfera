import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getFunnelBoard, moveFunnelLead } from '@/lib/services/funnel/board';
import type { SessionPayload } from '@/lib/auth/jwt';
import type { SessionAccessProfile } from '@/lib/auth/accessProfile';

/**
 * G2.3 — доска воронки + move (диспетчер поверх lead-lifecycle) против Postgres.
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyId: string, partnerId: string, m1: string, m2: string, orgId: string;

const profile = (leads: SessionAccessProfile['leads']): SessionAccessProfile => ({
  id: 'p', name: 'Продажи', orders: 'own', organizations: 'own', threads: 'own',
  documents: 'own', finance: 'own', leads, tasks: 'all', capabilities: []
});
const s1 = (leads?: SessionAccessProfile['leads']): SessionPayload =>
  ({ sub: m1, role: 'manager', companyId, managedOrgIds: [], ...(leads ? { accessProfile: profile(leads) } : {}) } as unknown as SessionPayload);

async function mkLead(over: { assignedManagerId?: string; organizationId?: string; status?: 'new' | 'in_review' | 'qualified' } = {}): Promise<string> {
  return (await prisma.lead.create({
    data: {
      partnerId, createdByUserId: m1, clientCompanyName: `c-${STAMP}-${Math.random()}`,
      clientContactName: 'Контакт', subject: 'Запрос',
      ...(over.assignedManagerId ? { assignedManagerId: over.assignedManagerId } : {}),
      ...(over.organizationId ? { organizationId: over.organizationId } : {}),
      ...(over.status ? { status: over.status } : {})
    }
  })).id;
}
async function statusOf(id: string) {
  return (await prisma.lead.findUniqueOrThrow({ where: { id }, select: { status: true, funnelStageId: true } }));
}

beforeAll(async () => {
  prisma = new PrismaClient();
  companyId = (await prisma.company.create({ data: { name: `g23co-${STAMP}` } })).id;
  partnerId = (await prisma.partner.create({ data: { name: `g23p-${STAMP}`, slug: `g23p-${STAMP}` } })).id;
  m1 = (await prisma.user.create({ data: { email: `g23m1-${STAMP}@t.local`, name: 'M1', role: 'manager', companyId } })).id;
  m2 = (await prisma.user.create({ data: { email: `g23m2-${STAMP}@t.local`, name: 'M2', role: 'manager', companyId } })).id;
  orgId = (await prisma.organization.create({ data: { name: `g23org-${STAMP}`, companyId } })).id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { partnerId } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { userId: { in: [m1, m2] } } });
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [m1, m2] } } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('getFunnelBoard', () => {
  it('5 дефолтных колонок; новый лид попадает в «Новый лид»', async () => {
    const leadId = await mkLead();
    const board = await getFunnelBoard(prisma, s1('all'));
    expect(board.stages.map((s) => s.statusAnchor)).toEqual(['new', 'in_review', 'qualified', 'promoted_to_order', 'rejected']);
    const newCol = board.columns.find((c) => c.stage.statusAnchor === 'new')!;
    expect(newCol.cards.some((c) => c.id === leadId)).toBe(true);
  });
});

describe('moveFunnelLead — lifecycle dispatch', () => {
  it('new → default:in_review (setLeadStatus)', async () => {
    const id = await mkLead();
    const r = await moveFunnelLead(prisma, s1('all'), { leadId: id, toStageId: 'default:in_review' });
    expect(r).toEqual({ ok: true });
    expect((await statusOf(id)).status).toBe('in_review');
  });

  it('illegal new → default:qualified → lifecycle_violation', async () => {
    const id = await mkLead();
    const r = await moveFunnelLead(prisma, s1('all'), { leadId: id, toStageId: 'default:qualified' });
    expect(r).toEqual({ ok: false, error: 'lifecycle_violation' });
    expect((await statusOf(id)).status).toBe('new'); // не изменился
  });

  it('promoted_to_order без организации → org_required', async () => {
    const id = await mkLead();
    const r = await moveFunnelLead(prisma, s1('all'), { leadId: id, toStageId: 'default:promoted_to_order' });
    expect(r).toEqual({ ok: false, error: 'org_required' });
  });

  it('promoted_to_order с организацией → создаётся заказ', async () => {
    const id = await mkLead({ organizationId: orgId });
    const r = await moveFunnelLead(prisma, s1('all'), { leadId: id, toStageId: 'default:promoted_to_order' });
    expect(r).toEqual({ ok: true });
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id }, select: { status: true, promotedOrderId: true } });
    expect(lead.status).toBe('promoted_to_order');
    expect(lead.promotedOrderId).not.toBeNull();
  });

  it('rejected без причины → reason_required; с причиной → rejected', async () => {
    const id = await mkLead();
    expect(await moveFunnelLead(prisma, s1('all'), { leadId: id, toStageId: 'default:rejected' })).toEqual({ ok: false, error: 'reason_required' });
    expect(await moveFunnelLead(prisma, s1('all'), { leadId: id, toStageId: 'default:rejected', reason: 'дубль' })).toEqual({ ok: true });
    expect((await statusOf(id)).status).toBe('rejected');
  });

  it('несуществующая стадия → invalid_stage', async () => {
    const id = await mkLead();
    expect(await moveFunnelLead(prisma, s1('all'), { leadId: id, toStageId: 'nope' })).toEqual({ ok: false, error: 'invalid_stage' });
  });

  it('scope own: чужой лид (назначен M2) → not_found', async () => {
    const id = await mkLead({ assignedManagerId: m2 });
    const r = await moveFunnelLead(prisma, s1('own'), { leadId: id, toStageId: 'default:in_review' });
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });
});
