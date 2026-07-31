import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  listAccessProfiles,
  listAssignableUsers,
  createAccessProfile,
  updateAccessProfile,
  deleteAccessProfile,
  assignUserProfile,
  type AccessProfileInput,
} from '@/lib/services/access/profiles';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * G1.4 — сервис CRUD профилей доступа. Company-scoped (IDOR), валидация,
 * name-uniqueness, аудит, assign to user. Против живого Postgres.
 */

let prisma: PrismaClient;
const STAMP = Date.now();

let companyA: string, companyB: string;
let leaderAId: string, plainMgrAId: string, targetMgrAId: string, userBId: string;

const leaderA = (): SessionPayload =>
  ({
    sub: leaderAId,
    role: 'manager',
    managerRole: 'leader',
    companyId: companyA,
  }) as unknown as SessionPayload;
const adminA = (): SessionPayload =>
  ({ sub: leaderAId, role: 'admin', companyId: companyA }) as unknown as SessionPayload;
const plainMgrA = (): SessionPayload =>
  ({ sub: plainMgrAId, role: 'manager', companyId: companyA }) as unknown as SessionPayload;

const input = (over: Partial<AccessProfileInput> = {}): AccessProfileInput => ({
  name: `Роль-${STAMP}`,
  orders: 'assigned',
  organizations: 'assigned',
  threads: 'assigned',
  documents: 'assigned',
  finance: 'own',
  leads: 'own',
  tasks: 'own',
  capabilities: [],
  ...over,
});

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `apA-${STAMP}` } })).id;
  companyB = (await prisma.company.create({ data: { name: `apB-${STAMP}` } })).id;
  leaderAId = (
    await prisma.user.create({
      data: {
        email: `apLeader-${STAMP}@t.local`,
        name: 'Leader A',
        role: 'manager',
        managerRole: 'leader',
        companyId: companyA,
      },
    })
  ).id;
  plainMgrAId = (
    await prisma.user.create({
      data: {
        email: `apMgr-${STAMP}@t.local`,
        name: 'Mgr A',
        role: 'manager',
        companyId: companyA,
      },
    })
  ).id;
  targetMgrAId = (
    await prisma.user.create({
      data: {
        email: `apTarget-${STAMP}@t.local`,
        name: 'Target A',
        role: 'manager',
        companyId: companyA,
      },
    })
  ).id;
  userBId = (
    await prisma.user.create({
      data: {
        email: `apUserB-${STAMP}@t.local`,
        name: 'User B',
        role: 'manager',
        companyId: companyB,
      },
    })
  ).id;
});

afterAll(async () => {
  const userIds = [leaderAId, plainMgrAId, targetMgrAId, userBId];
  // Audit rows reference the actor via AuditLog.userId FK — clear them first.
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.accessProfile.deleteMany({ where: { companyId: { in: [companyA, companyB] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('createAccessProfile', () => {
  it('leader creates a profile in own company; it appears in the list', async () => {
    const res = await createAccessProfile(prisma, leaderA(), input({ name: `Оператор-${STAMP}` }));
    expect(res.ok).toBe(true);
    const list = await listAccessProfiles(prisma, leaderA());
    expect(list.ok).toBe(true);
    if (list.ok) {
      const found = list.rows.find((r) => r.name === `Оператор-${STAMP}`);
      expect(found).toBeDefined();
      expect(found?.orders).toBe('assigned');
      expect(found?.finance).toBe('own');
    }
  });

  it('duplicate name in company → name_taken', async () => {
    await createAccessProfile(prisma, leaderA(), input({ name: `Dup-${STAMP}` }));
    const res = await createAccessProfile(prisma, leaderA(), input({ name: `Dup-${STAMP}` }));
    expect(res).toEqual({ ok: false, error: 'name_taken' });
  });

  it('invalid scope level → validation', async () => {
    const bad = { ...input(), orders: 'everything' } as unknown as AccessProfileInput;
    const res = await createAccessProfile(prisma, leaderA(), bad);
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it('empty name → validation', async () => {
    const res = await createAccessProfile(prisma, leaderA(), input({ name: '   ' }));
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it('admin can also create', async () => {
    const res = await createAccessProfile(prisma, adminA(), input({ name: `AdminMade-${STAMP}` }));
    expect(res.ok).toBe(true);
  });

  it('plain manager (not leader) → forbidden', async () => {
    const res = await createAccessProfile(prisma, plainMgrA(), input({ name: `Nope-${STAMP}` }));
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('updateAccessProfile', () => {
  it('updates matrix + capabilities and writes audit', async () => {
    const created = await createAccessProfile(prisma, leaderA(), input({ name: `Upd-${STAMP}` }));
    expect(created.ok).toBe(true);
    const id = created.ok ? created.id : '';
    const res = await updateAccessProfile(
      prisma,
      leaderA(),
      id,
      input({ name: `Upd-${STAMP}`, orders: 'all', capabilities: ['see_commission'] })
    );
    expect(res.ok).toBe(true);
    const row = await prisma.accessProfile.findUniqueOrThrow({ where: { id } });
    expect(row.ordersScope).toBe('all');
    expect(row.capabilities).toEqual(['see_commission']);
    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'access_profile', entityId: id, action: 'access_profile_updated' },
    });
    expect(audit).not.toBeNull();
  });

  it('cross-company profile → not_found (IDOR)', async () => {
    const inB = await createAccessProfile(
      prisma,
      { sub: userBId, role: 'admin', companyId: companyB } as unknown as SessionPayload,
      input({ name: `InB-${STAMP}` })
    );
    expect(inB.ok).toBe(true);
    const idB = inB.ok ? inB.id : '';
    const res = await updateAccessProfile(prisma, leaderA(), idB, input({ name: `InB-${STAMP}` }));
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('assignUserProfile', () => {
  it('assigns a company user to a profile; clears with null', async () => {
    const created = await createAccessProfile(
      prisma,
      leaderA(),
      input({ name: `Assign-${STAMP}` })
    );
    const id = created.ok ? created.id : '';
    const res = await assignUserProfile(prisma, leaderA(), { userId: targetMgrAId, profileId: id });
    expect(res.ok).toBe(true);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: targetMgrAId } })).accessProfileId
    ).toBe(id);
    const cleared = await assignUserProfile(prisma, leaderA(), {
      userId: targetMgrAId,
      profileId: null,
    });
    expect(cleared.ok).toBe(true);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: targetMgrAId } })).accessProfileId
    ).toBeNull();
  });

  it('cross-company target user → not_found (IDOR)', async () => {
    const created = await createAccessProfile(
      prisma,
      leaderA(),
      input({ name: `AssignX-${STAMP}` })
    );
    const id = created.ok ? created.id : '';
    const res = await assignUserProfile(prisma, leaderA(), { userId: userBId, profileId: id });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('deleteAccessProfile', () => {
  it('deletes profile; assigned user accessProfileId is nulled (FK SET NULL)', async () => {
    const created = await createAccessProfile(prisma, leaderA(), input({ name: `Del-${STAMP}` }));
    const id = created.ok ? created.id : '';
    await assignUserProfile(prisma, leaderA(), { userId: targetMgrAId, profileId: id });
    const res = await deleteAccessProfile(prisma, leaderA(), id);
    expect(res.ok).toBe(true);
    expect(await prisma.accessProfile.findUnique({ where: { id } })).toBeNull();
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: targetMgrAId } })).accessProfileId
    ).toBeNull();
  });

  it('cross-company delete → not_found', async () => {
    const inB = await createAccessProfile(
      prisma,
      { sub: userBId, role: 'admin', companyId: companyB } as unknown as SessionPayload,
      input({ name: `DelB-${STAMP}` })
    );
    const idB = inB.ok ? inB.id : '';
    const res = await deleteAccessProfile(prisma, leaderA(), idB);
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('listAccessProfiles', () => {
  it('lists only the session company profiles', async () => {
    const list = await listAccessProfiles(prisma, leaderA());
    expect(list.ok).toBe(true);
    if (list.ok) {
      // все строки — компании A (в B создавались отдельные)
      const ids = list.rows.map((r) => r.id);
      const bProfiles = await prisma.accessProfile.findMany({
        where: { companyId: companyB },
        select: { id: true },
      });
      for (const b of bProfiles) expect(ids).not.toContain(b.id);
    }
  });

  it('forbidden for a plain manager', async () => {
    const res = await listAccessProfiles(prisma, plainMgrA());
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('listAssignableUsers', () => {
  it('returns only company managers with their current profile', async () => {
    const res = await listAssignableUsers(prisma, leaderA());
    expect(res.ok).toBe(true);
    if (res.ok) {
      const ids = res.rows.map((r) => r.id);
      expect(ids).toContain(targetMgrAId);
      expect(ids).toContain(leaderAId);
      expect(ids).not.toContain(userBId); // company B excluded
      expect(res.rows.every((r) => 'accessProfileId' in r)).toBe(true);
    }
  });

  it('forbidden for a plain manager', async () => {
    const res = await listAssignableUsers(prisma, plainMgrA());
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
});
