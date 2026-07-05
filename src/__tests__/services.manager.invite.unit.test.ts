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
  it('returns org_not_found when org does not exist', async () => {
    const { tx } = makeTx();
    tx.organization.findUnique = vi.fn().mockResolvedValue(null);
    const p = makePrisma(tx);
    expect(
      await createAndAssignManager(p, { mode: 'existing', organizationId: 'nonexistent', email: 'x@t.local' }, 'admin-1')
    ).toEqual({ ok: false, error: 'org_not_found' });
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('createAndAssignManager — mode=existing', () => {
  it('returns user_not_found when email is unknown', async () => {
    const { tx } = makeTx();
    tx.user.findUnique = vi.fn().mockResolvedValue(null);
    const p = makePrisma(tx);
    expect(
      await createAndAssignManager(p, { mode: 'existing', organizationId: 'org-1', email: 'ghost@t.local' }, 'admin-1')
    ).toEqual({ ok: false, error: 'user_not_found' });
  });

  it('returns role_conflict when user exists but is not a manager', async () => {
    const { tx, existingNonMgr } = makeTx();
    tx.user.findUnique = vi.fn().mockResolvedValue(existingNonMgr);
    const p = makePrisma(tx);
    expect(
      await createAndAssignManager(p, { mode: 'existing', organizationId: 'org-1', email: existingNonMgr.email }, 'admin-1')
    ).toEqual({ ok: false, error: 'role_conflict' });
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
    if (!result.ok) throw new Error('expected ok');
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
      if (!result.ok) throw new Error('expected ok');
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
    if (!result.ok) throw new Error('expected ok');
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

  it('returns role_conflict for mode=new when existing user is not a manager', async () => {
    const { tx, existingNonMgr } = makeTx();
    tx.user.findUnique = vi.fn().mockResolvedValue(existingNonMgr);
    const p = makePrisma(tx);
    expect(
      await createAndAssignManager(p, { mode: 'new', organizationId: 'org-1', email: existingNonMgr.email }, 'admin-1')
    ).toEqual({ ok: false, error: 'role_conflict' });
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
    if (!result.ok) throw new Error('expected ok');
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
    if (!result.ok) throw new Error('expected ok');
    expect(result.reactivated).toBe(true);
    expect(tx.organizationManager.create).not.toHaveBeenCalled();
    expect(tx.organizationManager.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: true, deactivatedAt: null }) })
    );
  });

  it('returns already_assigned when existing assignment is active', async () => {
    const { tx, existingMgr } = makeTx();
    const activeAssignment = { id: 'assign-active', organizationId: 'org-1', isActive: true };
    tx.user.findUnique = vi.fn().mockResolvedValue(existingMgr);
    tx.organizationManager.findUnique = vi.fn().mockResolvedValue(activeAssignment);
    const p = makePrisma(tx);
    expect(
      await createAndAssignManager(p, { mode: 'existing', organizationId: 'org-1', email: existingMgr.email }, 'admin-1')
    ).toEqual({ ok: false, error: 'already_assigned' });
  });
});

// ─── createAndAssignManager — C8 company floor ─────────────────────────────────

describe('createAndAssignManager — C8 company floor', () => {
  it('rejects an existing manager whose companyId differs from the org (company_mismatch)', async () => {
    const { tx } = makeTx();
    tx.organization.findUnique = vi.fn().mockResolvedValue({ id: 'org-1', companyId: 'co-A' });
    const foreignMgr = { id: 'u-foreign', email: 'foreign@t.local', role: 'manager', passwordHash: 'hash', companyId: 'co-B' };
    tx.user.findUnique = vi.fn().mockResolvedValue(foreignMgr);
    const p = makePrisma(tx);

    expect(
      await createAndAssignManager(p, { mode: 'existing', organizationId: 'org-1', email: foreignMgr.email }, 'admin-1')
    ).toEqual({ ok: false, error: 'company_mismatch' });
    // No assignment row must be created on a cross-company reject.
    expect(tx.organizationManager.create).not.toHaveBeenCalled();
    expect(tx.organizationManager.update).not.toHaveBeenCalled();
  });

  it('allows an existing manager in the same company as the org', async () => {
    const { tx } = makeTx();
    tx.organization.findUnique = vi.fn().mockResolvedValue({ id: 'org-1', companyId: 'co-A' });
    const sameCompanyMgr = { id: 'u-same', email: 'same@t.local', role: 'manager', passwordHash: 'hash', companyId: 'co-A' };
    tx.user.findUnique = vi.fn().mockResolvedValue(sameCompanyMgr);
    tx.organizationManager.findUnique = vi.fn().mockResolvedValue(null);
    tx.organizationManager.create = vi.fn().mockResolvedValue({ id: 'assign-1', organizationId: 'org-1' });
    const p = makePrisma(tx);

    const result = await createAndAssignManager(
      p, { mode: 'existing', organizationId: 'org-1', email: sameCompanyMgr.email }, 'admin-1'
    );
    if (!result.ok) throw new Error('expected ok');
    expect(tx.organizationManager.create).toHaveBeenCalled();
  });

  it('stamps a newly-created manager with the org companyId (mode=new)', async () => {
    const { tx } = makeTx();
    tx.organization.findUnique = vi.fn().mockResolvedValue({ id: 'org-1', companyId: 'co-A' });
    tx.user.findUnique = vi.fn().mockResolvedValue(null);
    const created = { id: 'u-new', email: 'new@t.local', role: 'manager', passwordHash: null, companyId: 'co-A' };
    tx.user.create = vi.fn().mockResolvedValue(created);
    tx.organizationManager.findUnique = vi.fn().mockResolvedValue(null);
    tx.organizationManager.create = vi.fn().mockResolvedValue({ id: 'assign-1', organizationId: 'org-1' });
    const p = makePrisma(tx);

    const result = await createAndAssignManager(
      p, { mode: 'new', organizationId: 'org-1', email: created.email, name: 'Fresh' }, 'admin-1'
    );
    if (!result.ok) throw new Error('expected ok');
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'co-A' })
    });
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
