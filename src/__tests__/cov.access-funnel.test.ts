import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  createAccessProfile,
  updateAccessProfile,
  deleteAccessProfile,
  assignUserProfile,
  listAssignableUsers,
  type AccessProfileInput
} from '@/lib/services/access/profiles';
import {
  listFunnelStages,
  createFunnelStage,
  updateFunnelStage,
  deleteFunnelStage,
  type FunnelStageInput
} from '@/lib/services/access/funnelStages';
import { getFunnelBoard, moveFunnelLead } from '@/lib/services/funnel/board';
import { resolveFunnelStages, DEFAULT_FUNNEL_STAGES, stageForLead } from '@/lib/funnel/stages';
import { canSeeLead, leadWhereForLevel, type SessionAccessProfile } from '@/lib/auth/accessProfile';

/**
 * Track E / E1 — coverage top-up for the G1 (access profiles) + G2 (funnel)
 * surface. Mirrors services.access.profiles.integration.test.ts,
 * services.access.funnelStages.integration.test.ts, services.funnel.board.integration.test.ts
 * and funnel.stages.unit.test.ts. Targets only the branches/lines the 100% gate
 * lost after later tracks merged: forbidden/validation gates, unexpected-error
 * re-throw paths (triggered deterministically via the AuditLog.userId FK), the
 * custom-stage resolve path, the within-anchor reposition path, and the pure
 * canSeeLead assigned-scope helper.
 *
 * Server-action portion: mock only next/cache (needs Next runtime) and
 * requireRole (needs cookies); the real prisma singleton + real services run
 * against the same live Postgres, so the action error-mapping branches are
 * exercised end-to-end.
 */

const { revalidatePath, requireSession } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  requireSession: vi.fn()
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));

// Imported AFTER the mocks so the action modules pick up the mocked deps.
// The real @/lib/db/prisma singleton points at the same DATABASE_URL.
import {
  deleteAccessProfileAction
} from '@/server-actions/access/profiles';
import {
  moveFunnelLeadAction,
  updateFunnelStageAction,
  deleteFunnelStageAction
} from '@/server-actions/funnel';

let prisma: PrismaClient;
const STAMP = Date.now();

let companyA: string, companyB: string, cleanCo: string;
let leaderAId: string, plainMgrAId: string, targetMgrAId: string, userBId: string, cleanLeaderId: string;

const leaderA = (): SessionPayload =>
  ({ sub: leaderAId, role: 'manager', managerRole: 'leader', companyId: companyA } as unknown as SessionPayload);
// Dedicated company that NEVER gets custom funnel stages → resolveFunnelStages
// returns DEFAULT_FUNNEL_STAGES so `default:*` stage ids are valid. companyA is
// polluted with custom FunnelStage rows by the funnelStages block, which would
// otherwise make `default:*` resolve to invalid_stage.
const cleanLeader = (): SessionPayload =>
  ({ sub: cleanLeaderId, role: 'manager', managerRole: 'leader', companyId: cleanCo } as unknown as SessionPayload);
const plainMgrA = (): SessionPayload =>
  ({ sub: plainMgrAId, role: 'manager', companyId: companyA } as unknown as SessionPayload);
const adminB = (): SessionPayload =>
  ({ sub: userBId, role: 'admin', companyId: companyB } as unknown as SessionPayload);
// admin session with a company but a NON-existent actor id → recordAudit's
// AuditLog.userId FK (→ User.id) fails with P2003 (not P2002, not our sentinel
// error) → the defensive `throw e` re-throw runs.
const ghostAdminA = (): SessionPayload =>
  ({ sub: `ghost-${STAMP}`, role: 'admin', companyId: companyA } as unknown as SessionPayload);

const pInput = (over: Partial<AccessProfileInput> = {}): AccessProfileInput => ({
  name: `E1-роль-${STAMP}`,
  orders: 'assigned',
  organizations: 'assigned',
  threads: 'assigned',
  documents: 'assigned',
  finance: 'own',
  leads: 'own',
  tasks: 'own',
  capabilities: [],
  ...over
});

const fsInput = (over: Partial<FunnelStageInput> = {}): FunnelStageInput => ({
  name: `E1-стадия-${STAMP}`,
  position: 0,
  statusAnchor: 'qualified',
  color: null,
  isTerminal: false,
  ...over
});

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `e1A-${STAMP}` } })).id;
  companyB = (await prisma.company.create({ data: { name: `e1B-${STAMP}` } })).id;
  cleanCo = (await prisma.company.create({ data: { name: `e1Clean-${STAMP}` } })).id;
  cleanLeaderId = (await prisma.user.create({
    data: { email: `e1Clean-${STAMP}@t.local`, name: 'Clean Leader', role: 'manager', managerRole: 'leader', companyId: cleanCo }
  })).id;
  leaderAId = (await prisma.user.create({
    data: { email: `e1Leader-${STAMP}@t.local`, name: 'Leader A', role: 'manager', managerRole: 'leader', companyId: companyA }
  })).id;
  plainMgrAId = (await prisma.user.create({
    data: { email: `e1Mgr-${STAMP}@t.local`, name: 'Mgr A', role: 'manager', companyId: companyA }
  })).id;
  targetMgrAId = (await prisma.user.create({
    data: { email: `e1Target-${STAMP}@t.local`, name: 'Target A', role: 'manager', companyId: companyA }
  })).id;
  userBId = (await prisma.user.create({
    data: { email: `e1UserB-${STAMP}@t.local`, name: 'User B', role: 'admin', companyId: companyB }
  })).id;
});

afterAll(async () => {
  const userIds = [leaderAId, plainMgrAId, targetMgrAId, userBId, cleanLeaderId];
  const coIds = [companyA, companyB, cleanCo];
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.lead.deleteMany({ where: { createdByUserId: { in: userIds } } });
  await prisma.order.deleteMany({ where: { companyId: { in: coIds } } });
  await prisma.funnelStage.deleteMany({ where: { companyId: { in: coIds } } });
  await prisma.accessProfile.deleteMany({ where: { companyId: { in: coIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.company.deleteMany({ where: { id: { in: coIds } } });
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────
// access/profiles.ts — forbidden gates, update validation, name_taken-on-update,
// cross-company profile on assign, and the unexpected-error re-throw paths.
// ─────────────────────────────────────────────────────────────────────────────
describe('access/profiles — gates + error re-throws', () => {
  it('updateAccessProfile: plain manager → forbidden', async () => {
    const res = await updateAccessProfile(prisma, plainMgrA(), 'whatever', pInput());
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('updateAccessProfile: invalid scope level → validation', async () => {
    const bad = { ...pInput(), orders: 'everything' } as unknown as AccessProfileInput;
    const res = await updateAccessProfile(prisma, leaderA(), 'whatever', bad);
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it('updateAccessProfile: rename onto an existing name in same company → name_taken', async () => {
    const a = await createAccessProfile(prisma, leaderA(), pInput({ name: `E1-nameA-${STAMP}` }));
    const b = await createAccessProfile(prisma, leaderA(), pInput({ name: `E1-nameB-${STAMP}` }));
    expect(a.ok && b.ok).toBe(true);
    const idB = b.ok ? b.id : '';
    const res = await updateAccessProfile(prisma, leaderA(), idB, pInput({ name: `E1-nameA-${STAMP}` }));
    expect(res).toEqual({ ok: false, error: 'name_taken' });
  });

  it('createAccessProfile: non-unique error re-throw (P2003 via ghost actor FK) propagates', async () => {
    // gate passes (admin + companyA), name unique, so it reaches the tx; recordAudit
    // writes AuditLog.userId = ghost id → FK P2003 (not P2002) → catch re-throws.
    await expect(
      createAccessProfile(prisma, ghostAdminA(), pInput({ name: `E1-ghostCreate-${STAMP}` }))
    ).rejects.toBeTruthy();
  });

  it('updateAccessProfile: unexpected error re-throw (ghost actor FK) propagates', async () => {
    const created = await createAccessProfile(prisma, leaderA(), pInput({ name: `E1-ghostUpd-${STAMP}` }));
    const id = created.ok ? created.id : '';
    await expect(
      updateAccessProfile(prisma, ghostAdminA(), id, pInput({ name: `E1-ghostUpd-${STAMP}` }))
    ).rejects.toBeTruthy();
  });

  it('deleteAccessProfile: plain manager → forbidden', async () => {
    const res = await deleteAccessProfile(prisma, plainMgrA(), 'whatever');
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('deleteAccessProfile: unexpected error re-throw (ghost actor FK) propagates', async () => {
    const created = await createAccessProfile(prisma, leaderA(), pInput({ name: `E1-ghostDel-${STAMP}` }));
    const id = created.ok ? created.id : '';
    await expect(deleteAccessProfile(prisma, ghostAdminA(), id)).rejects.toBeTruthy();
    // profile survived (tx rolled back) — cleaned up by afterAll.
    expect(await prisma.accessProfile.findUnique({ where: { id } })).not.toBeNull();
  });

  it('assignUserProfile: plain manager → forbidden', async () => {
    const res = await assignUserProfile(prisma, plainMgrA(), { userId: targetMgrAId, profileId: null });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('assignUserProfile: cross-company profileId (valid user) → not_found', async () => {
    const inB = await createAccessProfile(prisma, adminB(), pInput({ name: `E1-assignProfB-${STAMP}` }));
    const idB = inB.ok ? inB.id : '';
    const res = await assignUserProfile(prisma, leaderA(), { userId: targetMgrAId, profileId: idB });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('assignUserProfile: unexpected error re-throw (ghost actor FK) propagates', async () => {
    const created = await createAccessProfile(prisma, leaderA(), pInput({ name: `E1-assignThrow-${STAMP}` }));
    const id = created.ok ? created.id : '';
    // ghost admin passes the gate and both entity checks (user + profile in companyA),
    // then recordAudit FK-fails → catch re-throws.
    await expect(
      assignUserProfile(prisma, ghostAdminA(), { userId: targetMgrAId, profileId: id })
    ).rejects.toBeTruthy();
  });

  it('listAssignableUsers: plain manager → forbidden', async () => {
    const res = await listAssignableUsers(prisma, plainMgrA());
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// access/funnelStages.ts — list forbidden, update forbidden/validation,
// position_taken-on-update, toColumns non-null color side, and re-throws.
// ─────────────────────────────────────────────────────────────────────────────
describe('access/funnelStages — gates + error re-throws', () => {
  it('listFunnelStages: plain manager → forbidden', async () => {
    const res = await listFunnelStages(prisma, plainMgrA());
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('updateFunnelStage: plain manager → forbidden', async () => {
    const res = await updateFunnelStage(prisma, plainMgrA(), 'whatever', fsInput());
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('updateFunnelStage: empty name → validation', async () => {
    const res = await updateFunnelStage(prisma, leaderA(), 'whatever', fsInput({ name: '   ' }));
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it('createFunnelStage: non-null color/isTerminal columns persist (toColumns non-nullish side)', async () => {
    const created = await createFunnelStage(
      prisma,
      leaderA(),
      fsInput({ position: 100, name: `E1-color-${STAMP}`, color: '#F97316', isTerminal: undefined })
    );
    expect(created.ok).toBe(true);
    const id = created.ok ? created.id : '';
    const row = await prisma.funnelStage.findUniqueOrThrow({ where: { id } });
    expect(row.color).toBe('#F97316');
    expect(row.isTerminal).toBe(false); // isTerminal ?? false
  });

  it('updateFunnelStage: colliding position in company → position_taken', async () => {
    const a = await createFunnelStage(prisma, leaderA(), fsInput({ position: 110, name: `E1-posA-${STAMP}` }));
    const b = await createFunnelStage(prisma, leaderA(), fsInput({ position: 111, name: `E1-posB-${STAMP}` }));
    expect(a.ok && b.ok).toBe(true);
    const idB = b.ok ? b.id : '';
    const res = await updateFunnelStage(prisma, leaderA(), idB, fsInput({ position: 110, name: `E1-posB-${STAMP}` }));
    expect(res).toEqual({ ok: false, error: 'position_taken' });
  });

  it('createFunnelStage: unexpected error re-throw (ghost actor FK) propagates', async () => {
    await expect(
      createFunnelStage(prisma, ghostAdminA(), fsInput({ position: 120, name: `E1-fsGhostCreate-${STAMP}` }))
    ).rejects.toBeTruthy();
  });

  it('updateFunnelStage: unexpected error re-throw (ghost actor FK) propagates', async () => {
    const created = await createFunnelStage(prisma, leaderA(), fsInput({ position: 130, name: `E1-fsGhostUpd-${STAMP}` }));
    const id = created.ok ? created.id : '';
    await expect(
      updateFunnelStage(prisma, ghostAdminA(), id, fsInput({ position: 130, name: `E1-fsGhostUpd-${STAMP}` }))
    ).rejects.toBeTruthy();
  });

  it('deleteFunnelStage: plain manager → forbidden', async () => {
    const res = await deleteFunnelStage(prisma, plainMgrA(), 'whatever');
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('deleteFunnelStage: unexpected error re-throw (ghost actor FK) propagates', async () => {
    const created = await createFunnelStage(prisma, leaderA(), fsInput({ position: 140, name: `E1-fsGhostDel-${STAMP}` }));
    const id = created.ok ? created.id : '';
    await expect(deleteFunnelStage(prisma, ghostAdminA(), id)).rejects.toBeTruthy();
    expect(await prisma.funnelStage.findUnique({ where: { id } })).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// funnel/stages.ts — resolveFunnelStages custom-stage mapping (L32-40, @31 false).
// ─────────────────────────────────────────────────────────────────────────────
describe('funnel/stages — resolveFunnelStages custom path', () => {
  it('empty company → DEFAULT_FUNNEL_STAGES clones', async () => {
    const resolved = await resolveFunnelStages(prisma, companyB); // no custom stages seeded for B
    expect(resolved.map((s) => s.id)).toEqual(DEFAULT_FUNNEL_STAGES.map((s) => s.id));
  });

  it('company with custom stages → maps DB rows (real cuids, ordered by position)', async () => {
    const co = (await prisma.company.create({ data: { name: `e1resolve-${STAMP}` } })).id;
    try {
      const s2 = await prisma.funnelStage.create({
        data: { companyId: co, name: 'Второй', position: 2, statusAnchor: 'qualified', color: '#111111', isTerminal: true }
      });
      const s1 = await prisma.funnelStage.create({
        data: { companyId: co, name: 'Первый', position: 1, statusAnchor: 'new', color: null, isTerminal: false }
      });
      const resolved = await resolveFunnelStages(prisma, co);
      expect(resolved.map((s) => s.id)).toEqual([s1.id, s2.id]); // position asc
      expect(resolved[0]).toMatchObject({ name: 'Первый', position: 1, statusAnchor: 'new', color: null, isTerminal: false });
      expect(resolved[1]).toMatchObject({ name: 'Второй', position: 2, statusAnchor: 'qualified', color: '#111111', isTerminal: true });
    } finally {
      await prisma.funnelStage.deleteMany({ where: { companyId: co } });
      await prisma.company.deleteMany({ where: { id: co } });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// funnel/board.ts — no-profile empty filter, no-companyId resolve(''), card
// field fallbacks, !stage continue, forbidden/not_found, custom-stage
// reposition-within-anchor, and lifecycle_violation dispatch branches.
// ─────────────────────────────────────────────────────────────────────────────
describe('funnel/board — getFunnelBoard branches', () => {
  it('no accessProfile → empty lead filter (where={}) + card field fallbacks', async () => {
    // org-less, manager-less, amount-less lead → organizationName/assignedManagerName/estimatedAmount all null.
    const bareLead = await prisma.lead.create({
      data: {
        partnerId: (await prisma.partner.create({ data: { name: `e1bp-${STAMP}`, slug: `e1bp-${STAMP}` } })).id,
        createdByUserId: leaderAId,
        clientCompanyName: `E1-bare-${STAMP}`,
        clientContactName: 'K',
        subject: 'S'
      }
    });
    const noProfileSession = ({ sub: cleanLeaderId, role: 'manager', companyId: cleanCo, managedOrgIds: [] } as unknown as SessionPayload);
    const board = await getFunnelBoard(prisma, noProfileSession);
    const newCol = board.columns.find((c) => c.stage.statusAnchor === 'new')!;
    const card = newCol.cards.find((c) => c.id === bareLead.id)!;
    expect(card).toBeDefined();
    expect(card.estimatedAmount).toBeNull();
    expect(card.organizationName).toBeNull();
    expect(card.assignedManagerName).toBeNull();
    await prisma.lead.delete({ where: { id: bareLead.id } });
    await prisma.partner.deleteMany({ where: { slug: `e1bp-${STAMP}` } });
  });

  it('null companyId → resolveFunnelStages("") still returns default columns', async () => {
    const nullCoSession = ({ sub: leaderAId, role: 'manager', companyId: null, managedOrgIds: [] } as unknown as SessionPayload);
    const board = await getFunnelBoard(prisma, nullCoSession);
    expect(board.stages.map((s) => s.statusAnchor)).toEqual(['new', 'in_review', 'qualified', 'promoted_to_order', 'rejected']);
  });

  it('lead whose status anchor has no matching stage → card skipped (!stage continue)', async () => {
    const co = (await prisma.company.create({ data: { name: `e1skip-${STAMP}` } })).id;
    const partnerId = (await prisma.partner.create({ data: { name: `e1sp-${STAMP}`, slug: `e1sp-${STAMP}` } })).id;
    const mgr = (await prisma.user.create({ data: { email: `e1skipM-${STAMP}@t.local`, name: 'M', role: 'manager', companyId: co } })).id;
    try {
      // Custom stages cover new/in_review/qualified/promoted_to_order but NOT rejected.
      const anchors = ['new', 'in_review', 'qualified', 'promoted_to_order'] as const;
      for (let i = 0; i < anchors.length; i++) {
        await prisma.funnelStage.create({ data: { companyId: co, name: `st-${i}`, position: i, statusAnchor: anchors[i], color: null, isTerminal: false } });
      }
      const rejected = await prisma.lead.create({
        data: { partnerId, createdByUserId: mgr, clientCompanyName: 'x', clientContactName: 'y', subject: 'z', status: 'rejected' }
      });
      const session = ({ sub: mgr, role: 'manager', companyId: co, managedOrgIds: [] } as unknown as SessionPayload);
      const board = await getFunnelBoard(prisma, session);
      const allCardIds = board.columns.flatMap((c) => c.cards.map((k) => k.id));
      expect(allCardIds).not.toContain(rejected.id); // rejected anchor absent → skipped
    } finally {
      await prisma.lead.deleteMany({ where: { partnerId } });
      await prisma.funnelStage.deleteMany({ where: { companyId: co } });
      await prisma.user.deleteMany({ where: { id: mgr } });
      await prisma.partner.deleteMany({ where: { id: partnerId } });
      await prisma.company.deleteMany({ where: { id: co } });
    }
  });
});

describe('funnel/board — moveFunnelLead branches', () => {
  it('no companyId → forbidden', async () => {
    const session = ({ sub: leaderAId, role: 'manager', companyId: null } as unknown as SessionPayload);
    const res = await moveFunnelLead(prisma, session, { leadId: 'x', toStageId: 'default:new' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('nonexistent leadId (valid stage) → not_found', async () => {
    const res = await moveFunnelLead(prisma, cleanLeader(), { leadId: `no-such-${STAMP}`, toStageId: 'default:new' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('move within same anchor to a CUSTOM stage → repositions (funnelStageId = real cuid)', async () => {
    const co = (await prisma.company.create({ data: { name: `e1repos-${STAMP}` } })).id;
    const partnerId = (await prisma.partner.create({ data: { name: `e1rp-${STAMP}`, slug: `e1rp-${STAMP}` } })).id;
    const mgr = (await prisma.user.create({ data: { email: `e1reposM-${STAMP}@t.local`, name: 'M', role: 'manager', companyId: co } })).id;
    try {
      // A custom stage whose anchor == lead.status ('new') → within-anchor reposition path.
      const stage = await prisma.funnelStage.create({
        data: { companyId: co, name: 'Новый (кастом)', position: 0, statusAnchor: 'new', color: null, isTerminal: false }
      });
      const lead = await prisma.lead.create({
        data: { partnerId, createdByUserId: mgr, clientCompanyName: 'x', clientContactName: 'y', subject: 'z', status: 'new' }
      });
      const session = ({ sub: mgr, role: 'manager', companyId: co, managedOrgIds: [] } as unknown as SessionPayload);
      const res = await moveFunnelLead(prisma, session, { leadId: lead.id, toStageId: stage.id });
      expect(res).toEqual({ ok: true });
      const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, select: { status: true, funnelStageId: true } });
      expect(after.status).toBe('new'); // no lifecycle transition
      expect(after.funnelStageId).toBe(stage.id); // persistStageId = real cuid (not default:)
    } finally {
      await prisma.lead.deleteMany({ where: { partnerId } });
      await prisma.funnelStage.deleteMany({ where: { companyId: co } });
      await prisma.user.deleteMany({ where: { id: mgr } });
      await prisma.partner.deleteMany({ where: { id: partnerId } });
      await prisma.company.deleteMany({ where: { id: co } });
    }
  });

  it('promote branch with ineligible (rejected) lead → lifecycle_violation', async () => {
    const partnerId = (await prisma.partner.create({ data: { name: `e1lvp-${STAMP}`, slug: `e1lvp-${STAMP}` } })).id;
    const org = await prisma.organization.create({ data: { name: `e1lvorg-${STAMP}`, companyId: cleanCo } });
    try {
      // rejected != promoted_to_order → enters promote branch; org set to satisfy the
      // org_required guard, but promoteLead refuses a 'rejected' lead → lifecycle_violation.
      const lead = await prisma.lead.create({
        data: { partnerId, createdByUserId: cleanLeaderId, clientCompanyName: 'x', clientContactName: 'y', subject: 'z', status: 'rejected', organizationId: org.id }
      });
      const res = await moveFunnelLead(prisma, cleanLeader(), { leadId: lead.id, toStageId: 'default:promoted_to_order' });
      expect(res).toEqual({ ok: false, error: 'lifecycle_violation' });
    } finally {
      await prisma.lead.deleteMany({ where: { partnerId } });
      await prisma.organization.deleteMany({ where: { id: org.id } });
      await prisma.partner.deleteMany({ where: { id: partnerId } });
    }
  });

  it('reject branch: with reason on a promoted lead → lifecycle_violation', async () => {
    const partnerId = (await prisma.partner.create({ data: { name: `e1rjp-${STAMP}`, slug: `e1rjp-${STAMP}` } })).id;
    const org = await prisma.organization.create({ data: { name: `e1rjorg-${STAMP}`, companyId: cleanCo } });
    try {
      // Create a promoted lead: promote a fresh org-linked lead first.
      const seed = await prisma.lead.create({
        data: { partnerId, createdByUserId: cleanLeaderId, clientCompanyName: 'x', clientContactName: 'y', subject: 'z', status: 'new', organizationId: org.id }
      });
      const promoted = await moveFunnelLead(prisma, cleanLeader(), { leadId: seed.id, toStageId: 'default:promoted_to_order' });
      expect(promoted).toEqual({ ok: true });
      // Now moving promoted → rejected enters reject branch (anchor differs); rejectLead
      // refuses a promoted lead → lifecycle_violation (reason present passes the guard).
      const res = await moveFunnelLead(prisma, cleanLeader(), { leadId: seed.id, toStageId: 'default:rejected', reason: 'нет' });
      expect(res).toEqual({ ok: false, error: 'lifecycle_violation' });
    } finally {
      await prisma.order.deleteMany({ where: { organizationId: org.id } });
      await prisma.lead.deleteMany({ where: { partnerId } });
      await prisma.organization.deleteMany({ where: { id: org.id } });
      await prisma.partner.deleteMany({ where: { id: partnerId } });
    }
  });

  it('setLeadStatus branch: illegal transition → lifecycle_violation', async () => {
    const partnerId = (await prisma.partner.create({ data: { name: `e1slp-${STAMP}`, slug: `e1slp-${STAMP}` } })).id;
    try {
      const lead = await prisma.lead.create({
        data: { partnerId, createdByUserId: cleanLeaderId, clientCompanyName: 'x', clientContactName: 'y', subject: 'z', status: 'new' }
      });
      // new → qualified is not an allowed manual move → setLeadStatus lifecycle_violation.
      const res = await moveFunnelLead(prisma, cleanLeader(), { leadId: lead.id, toStageId: 'default:qualified' });
      expect(res).toEqual({ ok: false, error: 'lifecycle_violation' });
    } finally {
      await prisma.lead.deleteMany({ where: { partnerId } });
      await prisma.partner.deleteMany({ where: { id: partnerId } });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auth/accessProfile.ts — canSeeLead assigned-scope helper (L119-121, @117) and
// leadWhereForLevel assigned branch (@104) exercised via the real helpers.
// ─────────────────────────────────────────────────────────────────────────────
describe('auth/accessProfile — canSeeLead (assigned scope)', () => {
  const profile = (leads: SessionAccessProfile['leads']): SessionAccessProfile => ({
    id: 'p', name: 'Продажи', orders: 'own', organizations: 'own', threads: 'own',
    documents: 'own', finance: 'own', leads, tasks: 'all', capabilities: []
  });
  const sess = (over: Partial<SessionPayload> = {}): SessionPayload =>
    ({ sub: 'u1', role: 'manager', companyId: 'co-1', managedOrgIds: ['o1', 'o2'], ...over } as unknown as SessionPayload);

  it('no profile → team-wide (true)', () => {
    expect(canSeeLead(sess(), { assignedManagerId: 'other', organizationId: 'oX' })).toBe(true);
  });

  it('leads=all → true regardless of assignment', () => {
    expect(canSeeLead(sess({ accessProfile: profile('all') }), { assignedManagerId: 'other', organizationId: 'oX' })).toBe(true);
  });

  it('leads=own → only self-assigned', () => {
    const s = sess({ accessProfile: profile('own') });
    expect(canSeeLead(s, { assignedManagerId: 'u1', organizationId: null })).toBe(true);
    expect(canSeeLead(s, { assignedManagerId: 'other', organizationId: 'o1' })).toBe(false);
  });

  it('leads=assigned → self-assigned OR managed-org lead; else false', () => {
    const s = sess({ accessProfile: profile('assigned') });
    // self-assigned
    expect(canSeeLead(s, { assignedManagerId: 'u1', organizationId: null })).toBe(true);
    // managed org (not self-assigned)
    expect(canSeeLead(s, { assignedManagerId: 'other', organizationId: 'o2' })).toBe(true);
    // neither: other manager + org null → false (also covers !!organizationId short-circuit)
    expect(canSeeLead(s, { assignedManagerId: 'other', organizationId: null })).toBe(false);
    // neither: other manager + unmanaged org → false
    expect(canSeeLead(s, { assignedManagerId: 'other', organizationId: 'oZ' })).toBe(false);
  });

  it('leadWhereForLevel assigned → OR(self, managed orgs)', () => {
    expect(leadWhereForLevel(sess({ sub: 'u7', managedOrgIds: ['o1', 'o2'] }), 'assigned')).toEqual({
      OR: [{ assignedManagerId: 'u7' }, { organizationId: { in: ['o1', 'o2'] } }]
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// funnel/stages.ts (pure) — stageForLead explicit / stale / anchor-fallback.
// ─────────────────────────────────────────────────────────────────────────────
describe('funnel/stages — stageForLead (pure)', () => {
  const stages = DEFAULT_FUNNEL_STAGES.map((s) => ({ ...s }));
  it('explicit funnelStageId present in set → that stage', () => {
    expect(stageForLead(stages, { status: 'new', funnelStageId: 'default:qualified' })?.id).toBe('default:qualified');
  });
  it('funnelStageId not in set → anchor fallback', () => {
    expect(stageForLead(stages, { status: 'in_review', funnelStageId: 'stale' })?.id).toBe('default:in_review');
  });
  it('funnelStageId null → anchor fallback', () => {
    expect(stageForLead(stages, { status: 'rejected', funnelStageId: null })?.id).toBe('default:rejected');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// server-actions — action-level error-mapping branches (real services, real DB;
// only next/cache + requireRole mocked).
// ─────────────────────────────────────────────────────────────────────────────
describe('server-actions — error-mapping branches', () => {
  it('deleteAccessProfileAction: service error (forbidden) → mapped, no revalidate', async () => {
    revalidatePath.mockClear();
    requireSession.mockResolvedValue(plainMgrA()); // plain manager → service forbidden
    const res = await deleteAccessProfileAction(form({ id: 'anything' }));
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('updateFunnelStageAction: service error (forbidden) → mapped, no revalidate', async () => {
    revalidatePath.mockClear();
    requireSession.mockResolvedValue(plainMgrA());
    const res = await updateFunnelStageAction(form({ id: 'anything', name: 'X', position: '0', statusAnchor: 'new' }));
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('deleteFunnelStageAction: service error (forbidden) → mapped, no revalidate', async () => {
    revalidatePath.mockClear();
    requireSession.mockResolvedValue(plainMgrA());
    const res = await deleteFunnelStageAction(form({ id: 'anything' }));
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('moveFunnelLeadAction: missing leadId → not_found (short-circuit !leadId)', async () => {
    revalidatePath.mockClear();
    requireSession.mockResolvedValue(leaderA());
    const res = await moveFunnelLeadAction(form({ toStageId: 'default:new' })); // no leadId
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('moveFunnelLeadAction: success → revalidates both cabinets', async () => {
    revalidatePath.mockClear();
    requireSession.mockResolvedValue(cleanLeader());
    const partnerId = (await prisma.partner.create({ data: { name: `e1sap-${STAMP}`, slug: `e1sap-${STAMP}` } })).id;
    try {
      const lead = await prisma.lead.create({
        data: { partnerId, createdByUserId: cleanLeaderId, clientCompanyName: 'x', clientContactName: 'y', subject: 'z', status: 'new' }
      });
      const res = await moveFunnelLeadAction(form({ leadId: lead.id, toStageId: 'default:in_review' }));
      expect(res).toEqual({ ok: true });
      expect(revalidatePath).toHaveBeenCalledWith('/leader/funnel');
      expect(revalidatePath).toHaveBeenCalledWith('/manager/funnel');
    } finally {
      await prisma.lead.deleteMany({ where: { partnerId } });
      await prisma.partner.deleteMany({ where: { id: partnerId } });
    }
  });
});
