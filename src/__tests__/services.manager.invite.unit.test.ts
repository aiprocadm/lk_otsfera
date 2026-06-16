/**
 * Unit tests for src/lib/services/manager/invite.ts
 * Covers branches not reachable by the integration test in unit mode:
 *   - org_not_found
 *   - mode=existing: user_not_found + role_conflict
 *   - mode=new: existing user with correct role (reuse path)
 *   - mode=new: existing non-manager (role_conflict)
 *   - reactivated path (existing inactive assignment)
 *   - already_assigned (existing active assignment)
 *   - alreadyHasPassword=true (passwordHash != null → no invite URL)
 *   - deactivateAssignment: not_found + idempotent (already inactive)
 *   - reactivateAssignment: not_found + idempotent (already active)
 */
import { describe, it, expect, vi } from 'vitest';

const { createInviteToken } = vi.hoisted(() => ({
  createInviteToken: vi.fn().mockResolvedValue({ token: 'tok-123' })
}));
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));

vi.mock('@/lib/auth/passwordReset', () => ({ createInviteToken }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import {
  createAndAssignManager,
  deactivateAssignment,
  reactivateAssignment
} from '@/lib/services/manager/invite';

// ─── helper: build a fake transaction client ───────────────────────────────────

function makeTx(overrides: Record<string, unknown> = {}) {
  const org = { id: 'org-1' };
  const newUser = { id: 'u-new', email: 'new@t.local', role: 'manager', passwordHash: null };
  const existingMgr = { id: 'u-mgr', email: 'mgr@t.local', role: 'manager', passwordHash: 'hash' };
  const existingNonMgr = { id: 'u-other', email: 'other@t.local', role: 'organization', passwordHash: 'hash' };

  return {
    org,
    newUser,
    existingMgr,
    existingNonMgr,
    tx: {
      organization: { findUnique: vi.fn().mockResolvedValue(org) },
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(newUser)
      },
      organizationManager: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'assign-1', organizationId: 'org-1' }),
        update: vi.fn()
      },
      auditLog: { create: vi.fn() },
      ...overrides
    }
  };
}

function makePrisma(tx: Record<string, unknown>) {
  return {
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    organizationManager: {
      findUnique: vi.fn(),
      update: vi.fn()
    },
    auditLog: { create: vi.fn() }
  } as never;
}

// ─── createAndAssignManager ────────────────────────────────────────────────────

describe('createAndAssignManager — org_not_found', () => {
  it('throws ManagerInviteError org_not_found when org does not exist', async () => {
    const { tx } = makeTx();
    tx.organization.findUnique = vi.fn().mockResolvedValue(null);
    const p = makePrisma(tx);
    await expect(
      createAndAssignManager(p, { mode: 'existing', organizationId: 'nonexistent', email: 'x@t.local' }, 'admin-1')
    ).rejects.toMatchObject({ code: 'org_not_found' });
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('createAndAssignManager — mode=existing', () => {
  it('throws user_not_found when email is unknown', async () => {
    const { tx } = makeTx();
    tx.user.findUnique = vi.fn().mockResolvedValue(null);
    const p = makePrisma(tx);
    await expect(
      createAndAssignManager(p, { mode: 'existing', organizationId: 'org-1', email: 'ghost@t.local' }, 'admin-1')
    ).rejects.toMatchObject({ code: 'user_not_found' });
  });

  it('throws role_conflict when user exists but is not a manager', async () => {
    const { tx, existingNonMgr } = makeTx();
    tx.user.findUnique = vi.fn().mockResolvedValue(existingNonMgr);
    const p = makePrisma(tx);
    await expect(
      createAndAssignManager(p, { mode: 'existing', organizationId: 'org-1', email: existingNonMgr.email }, 'admin-1')
    ).rejects.toMatchObject({ code: 'role_conflict' });
  });

  it('succeeds for existing manager with password (no invite URL, alreadyHasPassword=true)', async () => {
    const { tx, existingMgr } = makeTx();
    tx.user.findUnique = vi.fn().mockResolvedValue(existingMgr);
    tx.organizationManager.findUnique = vi.fn().mockResolvedValue(null);
    tx.organizationManager.create = vi.fn().mockResolvedValue({ id: 'assign-1', organizationId: 'org-1' });
    const p = makePrisma(tx);
    const result = await createAndAssignManager(
      p, { mode: 'existing', organizationId: 'org-1', email: existingMgr.email }, 'admin-1'
    );
    expect(result.inviteUrl).toBeNull();
    expect(result.alreadyHasPassword).toBe(true);
    expect(result.reactivated).toBe(false);
    expect(createInviteToken).not.toHaveBeenCalled();
  });
});

describe('createAndAssignManager — APP_URL env branch', () => {
  it('uses APP_URL env var for invite URL when set', async () => {
    const originalAppUrl = process.env['APP_URL'];
    process.env['APP_URL'] = 'https://custom.example.com';
    try {
      const { tx, newUser } = makeTx();
      tx.user.findUnique = vi.fn().mockResolvedValue(null);
      tx.user.create = vi.fn().mockResolvedValue(newUser);
      tx.organizationManager.findUnique = vi.fn().mockResolvedValue(null);
      tx.organizationManager.create = vi.fn().mockResolvedValue({ id: 'assign-env', organizationId: 'org-1' });
      const p = makePrisma(tx);
      const result = await createAndAssignManager(
        p, { mode: 'new', organizationId: 'org-1', email: newUser.email, name: 'Env test' }, 'admin-1'
      );
      expect(result.inviteUrl).toContain('https://custom.example.com');
    } finally {
      if (originalAppUrl === undefined) {
        delete process.env['APP_URL'];
      } else {
        process.env['APP_URL'] = originalAppUrl;
      }
    }
  });
});

describe('createAndAssignManager — mode=new', () => {
  it('creates new user and mints invite URL (passwordHash=null)', async () => {
    const { tx, newUser } = makeTx();
    tx.user.findUnique = vi.fn().mockResolvedValue(null);
    tx.user.create = vi.fn().mockResolvedValue(newUser);
    tx.organizationManager.findUnique = vi.fn().mockResolvedValue(null);
    tx.organizationManager.create = vi.fn().mockResolvedValue({ id: 'assign-2', organizationId: 'org-1' });
    const p = makePrisma(tx);
    const result = await createAndAssignManager(
      p, { mode: 'new', organizationId: 'org-1', email: newUser.email, name: 'Новый менеджер' }, 'admin-1'
    );
    expect(result.inviteUrl).toContain('tok-123');
    expect(result.alreadyHasPassword).toBe(false);
    expect(result.reactivated).toBe(false);
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: newUser.email, name: 'Новый менеджер', role: 'manager', passwordHash: null })
    });
  });

  it('uses email as name when name is not provided', async () => {
    const { tx, newUser } = makeTx();
    tx.user.findUnique = vi.fn().mockResolvedValue(null);
    tx.user.create = vi.fn().mockResolvedValue(newUser);
    tx.organizationManager.findUnique = vi.fn().mockResolvedValue(null);
    tx.organizationManager.create = vi.fn().mockResolvedValue({ id: 'assign-3', organizationId: 'org-1' });
    const p = makePrisma(tx);
    await createAndAssignManager(
      p, { mode: 'new', organizationId: 'org-1', email: 'user@t.local' }, 'admin-1'
    );
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'user@t.local' })
    });
  });

  it('throws role_conflict for mode=new when existing user is not a manager', async () => {
    const { tx, existingNonMgr } = makeTx();
    tx.user.findUnique = vi.fn().mockResolvedValue(existingNonMgr);
    const p = makePrisma(tx);
    await expect(
      createAndAssignManager(p, { mode: 'new', organizationId: 'org-1', email: existingNonMgr.email }, 'admin-1')
    ).rejects.toMatchObject({ code: 'role_conflict' });
  });

  it('reuses existing manager account for mode=new (passwordHash set)', async () => {
    const { tx, existingMgr } = makeTx();
    tx.user.findUnique = vi.fn().mockResolvedValue(existingMgr);
    tx.organizationManager.findUnique = vi.fn().mockResolvedValue(null);
    tx.organizationManager.create = vi.fn().mockResolvedValue({ id: 'assign-4', organizationId: 'org-1' });
    const p = makePrisma(tx);
    const result = await createAndAssignManager(
      p, { mode: 'new', organizationId: 'org-1', email: existingMgr.email }, 'admin-1'
    );
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(result.alreadyHasPassword).toBe(true);
    expect(result.inviteUrl).toBeNull();
  });
});

describe('createAndAssignManager — assignment reactivation', () => {
  it('reactivates inactive assignment instead of creating new one', async () => {
    const { tx, existingMgr } = makeTx();
    const inactiveAssignment = { id: 'assign-old', organizationId: 'org-1', isActive: false };
    tx.user.findUnique = vi.fn().mockResolvedValue(existingMgr);
    tx.organizationManager.findUnique = vi.fn().mockResolvedValue(inactiveAssignment);
    tx.organizationManager.update = vi.fn().mockResolvedValue({ id: 'assign-old', organizationId: 'org-1' });
    const p = makePrisma(tx);
    const result = await createAndAssignManager(
      p, { mode: 'existing', organizationId: 'org-1', email: existingMgr.email }, 'admin-1'
    );
    expect(result.reactivated).toBe(true);
    expect(tx.organizationManager.create).not.toHaveBeenCalled();
    expect(tx.organizationManager.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: true, deactivatedAt: null }) })
    );
  });

  it('throws already_assigned when existing assignment is active', async () => {
    const { tx, existingMgr } = makeTx();
    const activeAssignment = { id: 'assign-active', organizationId: 'org-1', isActive: true };
    tx.user.findUnique = vi.fn().mockResolvedValue(existingMgr);
    tx.organizationManager.findUnique = vi.fn().mockResolvedValue(activeAssignment);
    const p = makePrisma(tx);
    await expect(
      createAndAssignManager(p, { mode: 'existing', organizationId: 'org-1', email: existingMgr.email }, 'admin-1')
    ).rejects.toMatchObject({ code: 'already_assigned' });
  });
});

// ─── deactivateAssignment ──────────────────────────────────────────────────────

describe('deactivateAssignment', () => {
  it('returns not_found when assignment does not exist', async () => {
    const p = {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({
        organizationManager: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
        auditLog: { create: vi.fn() }
      })),
      organizationManager: { findUnique: vi.fn(), update: vi.fn() },
      auditLog: { create: vi.fn() }
    } as never;
    const result = await deactivateAssignment(p, 'nonexistent', 'admin-1');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('idempotent: returns ok when assignment is already inactive', async () => {
    const row = { id: 'a1', isActive: false, organizationId: 'org-1', userId: 'u-1' };
    const p = {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({
        organizationManager: { findUnique: vi.fn().mockResolvedValue(row), update: vi.fn() },
        auditLog: { create: vi.fn() }
      })),
      organizationManager: { findUnique: vi.fn(), update: vi.fn() },
      auditLog: { create: vi.fn() }
    } as never;
    const result = await deactivateAssignment(p, 'a1', 'admin-1');
    expect(result).toEqual({ ok: true, organizationId: 'org-1' });
  });

  it('deactivates an active assignment and records audit', async () => {
    const row = { id: 'a1', isActive: true, organizationId: 'org-1', userId: 'u-1' };
    const orgMgrUpdate = vi.fn().mockResolvedValue({ id: 'a1', organizationId: 'org-1' });
    const p = {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({
        organizationManager: { findUnique: vi.fn().mockResolvedValue(row), update: orgMgrUpdate },
        auditLog: { create: vi.fn() }
      })),
      organizationManager: { findUnique: vi.fn(), update: vi.fn() },
      auditLog: { create: vi.fn() }
    } as never;
    const result = await deactivateAssignment(p, 'a1', 'admin-1');
    expect(result).toEqual({ ok: true, organizationId: 'org-1' });
    expect(orgMgrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false }) })
    );
  });
});

// ─── reactivateAssignment ──────────────────────────────────────────────────────

describe('reactivateAssignment', () => {
  it('returns not_found when assignment does not exist', async () => {
    const p = {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({
        organizationManager: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
        auditLog: { create: vi.fn() }
      })),
      organizationManager: { findUnique: vi.fn(), update: vi.fn() },
      auditLog: { create: vi.fn() }
    } as never;
    const result = await reactivateAssignment(p, 'nonexistent', 'admin-1');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('idempotent: returns ok when assignment is already active', async () => {
    const row = { id: 'a1', isActive: true, organizationId: 'org-1', userId: 'u-1' };
    const p = {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({
        organizationManager: { findUnique: vi.fn().mockResolvedValue(row), update: vi.fn() },
        auditLog: { create: vi.fn() }
      })),
      organizationManager: { findUnique: vi.fn(), update: vi.fn() },
      auditLog: { create: vi.fn() }
    } as never;
    const result = await reactivateAssignment(p, 'a1', 'admin-1');
    expect(result).toEqual({ ok: true, organizationId: 'org-1' });
  });

  it('reactivates an inactive assignment', async () => {
    const row = { id: 'a1', isActive: false, organizationId: 'org-1', userId: 'u-1' };
    const orgMgrUpdate = vi.fn().mockResolvedValue({ id: 'a1', organizationId: 'org-1' });
    const p = {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({
        organizationManager: { findUnique: vi.fn().mockResolvedValue(row), update: orgMgrUpdate },
        auditLog: { create: vi.fn() }
      })),
      organizationManager: { findUnique: vi.fn(), update: vi.fn() },
      auditLog: { create: vi.fn() }
    } as never;
    const result = await reactivateAssignment(p, 'a1', 'admin-1');
    expect(result).toEqual({ ok: true, organizationId: 'org-1' });
    expect(orgMgrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: true, deactivatedAt: null }) })
    );
  });
});
