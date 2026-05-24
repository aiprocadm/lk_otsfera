import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock helpers hoisted so they are available before module imports
// ---------------------------------------------------------------------------
const { auditLogCreate } = vi.hoisted(() => {
  const auditLogCreate = vi.fn();
  return { auditLogCreate };
});

const mockPrisma = {
  auditLog: { create: auditLogCreate },
} as unknown as import('@prisma/client').PrismaClient;

import { recordAudit } from '@/lib/auth/audit';

// ---------------------------------------------------------------------------
// recordAudit
// ---------------------------------------------------------------------------
describe('recordAudit', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auditLogCreate.mockResolvedValue(undefined);
  });

  it('calls auditLog.create with meta.status = "success" by default', async () => {
    await recordAudit(mockPrisma, {
      userId: 'u1',
      action: 'login',
      entity: 'user',
      entityId: 'u1',
    });

    expect(auditLogCreate).toHaveBeenCalledOnce();
    const arg = auditLogCreate.mock.calls[0][0];
    expect(arg.data.userId).toBe('u1');
    expect(arg.data.action).toBe('login');
    expect(arg.data.entity).toBe('user');
    expect(arg.data.entityId).toBe('u1');
    expect(arg.data.meta.status).toBe('success');
    expect(arg.data.meta).not.toHaveProperty('before');
    expect(arg.data.meta).not.toHaveProperty('after');
    expect(arg.data.meta).not.toHaveProperty('reason');
  });

  it('persists status = "denied" in meta when provided', async () => {
    await recordAudit(mockPrisma, {
      userId: 'u2',
      action: 'delete',
      entity: 'order',
      entityId: 'ord-1',
      status: 'denied',
      reason: 'insufficient permissions',
    });

    const arg = auditLogCreate.mock.calls[0][0];
    expect(arg.data.meta.status).toBe('denied');
    expect(arg.data.meta.reason).toBe('insufficient permissions');
  });

  it('includes before and after in meta when both are provided', async () => {
    const before = { name: 'Old Name' };
    const after = { name: 'New Name' };

    await recordAudit(mockPrisma, {
      userId: 'u3',
      action: 'update',
      entity: 'partner',
      entityId: 'p-1',
      before,
      after,
    });

    const arg = auditLogCreate.mock.calls[0][0];
    expect(arg.data.meta.before).toEqual(before);
    expect(arg.data.meta.after).toEqual(after);
    expect(arg.data.meta.status).toBe('success');
  });

  it('omits before and after from meta when not provided (compact JSON)', async () => {
    await recordAudit(mockPrisma, {
      userId: 'u4',
      action: 'view',
      entity: 'document',
      entityId: 'doc-1',
    });

    const arg = auditLogCreate.mock.calls[0][0];
    expect(Object.keys(arg.data.meta)).toEqual(['status']);
  });

  it('includes reason in meta when provided', async () => {
    await recordAudit(mockPrisma, {
      userId: 'u5',
      action: 'approve',
      entity: 'commission_statement',
      entityId: 'cs-1',
      reason: 'manual override',
    });

    const arg = auditLogCreate.mock.calls[0][0];
    expect(arg.data.meta.reason).toBe('manual override');
  });

  it('accepts all valid entity values without TypeScript error', async () => {
    const entities = [
      'user',
      'partner',
      'organization',
      'order',
      'commission_statement',
      'lead',
      'document',
    ] as const;

    for (const entity of entities) {
      auditLogCreate.mockResolvedValue(undefined);
      await recordAudit(mockPrisma, {
        userId: 'u6',
        action: 'test',
        entity,
        entityId: 'e-1',
      });
    }

    expect(auditLogCreate).toHaveBeenCalledTimes(entities.length);
  });
});
